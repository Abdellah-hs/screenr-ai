"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { bulkCandidateActionSchema } from "@/lib/validations";
import { fetchCandidateById } from "@/lib/data/candidates";
import { transitionApplication } from "@/lib/data/transitions";
import { upsertTalentPoolEntry } from "@/lib/data/talent-pool-entries";
import { normalizePoolTags } from "@/lib/talent-pool/search";
import {
  planBulkAction,
  summarizeBulkResult,
  type BulkAction,
  type BulkCandidate,
  type BulkOutcome,
  type BulkResult,
} from "@/lib/rules/bulk-actions";
import { sendTransitionNotification } from "./transition-notifications";
import type { ApplicationState } from "@/lib/constants";

/**
 * Bulk operations on candidates (PRD 3.12.1).
 *
 * The state-machine constraint is the whole shape of this file: a bulk advance
 * is **N individual `transition()` calls**, each validated against that
 * application's own current state. It is never one `UPDATE`. An application
 * whose state makes the move illegal is reported as skipped — never silently
 * dropped — which is why every path returns a per-candidate outcome rather than
 * a count.
 *
 * The loop is deliberately sequential. Fanning out with `Promise.all` would
 * make the transition log's ordering depend on scheduling, and the rate limiter
 * this shares with the rest of the app is per-process and not built to be hit
 * fifty times at once.
 */

/** Ceiling on one batch. */
const MAX_BULK_SELECTION = 200;

/**
 * A batch of one is still a batch, but a batch of a thousand is an accident.
 *
 * The cap is enforced in the schema and repeated here as the reason: the
 * expensive failure mode for this feature is a recruiter emailing an entire
 * campaign by mis-clicking select-all, and no undo exists for a sent email.
 */
export { MAX_BULK_SELECTION };

interface ResolvedCandidate extends BulkCandidate {
  campaignId: string;
  candidateId: string;
}

/**
 * Load each selected application, scoped to the caller.
 *
 * Reads one at a time through `fetchCandidateById` rather than a single `IN`
 * query because that helper is where ownership is enforced — it throws on a
 * campaign the caller does not own. A crafted id in the selection therefore
 * fails closed rather than riding along in a batch query.
 */
async function resolveSelection(
  applicationIds: string[],
  userId: string,
): Promise<{ resolved: ResolvedCandidate[]; unreachable: BulkOutcome[] }> {
  const resolved: ResolvedCandidate[] = [];
  const unreachable: BulkOutcome[] = [];

  for (const applicationId of applicationIds) {
    try {
      const app = await fetchCandidateById(applicationId, userId);
      if (!app) {
        unreachable.push({
          applicationId,
          name: applicationId,
          status: "failed",
          detail: "Application not found.",
          toState: null,
        });
        continue;
      }

      const candidate = (app as { candidates?: { first_name?: string; last_name?: string; email?: string } }).candidates;
      const name =
        `${candidate?.first_name ?? ""} ${candidate?.last_name ?? ""}`.trim() ||
        candidate?.email ||
        applicationId;

      resolved.push({
        applicationId,
        name,
        currentState: app.status as ApplicationState,
        campaignId: app.campaign_id,
        candidateId: app.candidate_id,
      });
    } catch (err) {
      unreachable.push({
        applicationId,
        name: applicationId,
        status: "failed",
        detail: err instanceof Error ? err.message : "Could not load this application.",
        toState: null,
      });
    }
  }

  return { resolved, unreachable };
}

export interface BulkCandidateActionInput {
  applicationIds: string[];
  action: BulkAction;
  /** Recorded on every transition. Mandatory for advance and reject. */
  rationale?: string;
  /** Talent pool only. */
  tags?: string[];
  notes?: string;
}

/**
 * Run one bulk action over a selection, reporting what happened to each.
 *
 * A single rationale is recorded against every transition in the batch. That is
 * a real limitation and it is why `manager_review` is excluded from bulk
 * advance in the rule layer: for the decisions where the reasoning has to be
 * per-person, bulk is not offered at all rather than offered with a shared
 * sentence standing in for individual judgement.
 */
export async function bulkCandidateAction(
  input: BulkCandidateActionInput,
): Promise<BulkResult> {
  const userId = await requireUserId();

  const parsed = bulkCandidateActionSchema.parse(input);

  // Tighter than the single-candidate limits on purpose: one call here can be
  // 200 transitions and 200 emails, so the unit being limited is the batch.
  checkRateLimit(userId, {
    name: "bulk-candidate-action",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  const { resolved, unreachable } = await resolveSelection(parsed.applicationIds, userId);
  const plan = planBulkAction(resolved, parsed.action);

  const outcomes: BulkOutcome[] = [...unreachable];

  for (const entry of plan.skipped) {
    outcomes.push({
      applicationId: entry.applicationId,
      name: entry.name,
      status: "skipped",
      detail: entry.skipReason,
      toState: null,
    });
  }

  const byId = new Map(resolved.map((r) => [r.applicationId, r]));
  const touchedCampaigns = new Set<string>();

  for (const entry of plan.eligible) {
    const candidate = byId.get(entry.applicationId);
    if (!candidate) continue;

    try {
      if (parsed.action === "talent_pool") {
        await upsertTalentPoolEntry(userId, {
          candidateId: candidate.candidateId,
          sourceApplicationId: candidate.applicationId,
          sourceCampaignId: candidate.campaignId,
          tags: normalizePoolTags(parsed.tags ?? []),
          notes: parsed.notes && parsed.notes.length > 0 ? parsed.notes : null,
        });
      } else {
        const toState = entry.toState as ApplicationState;

        await transitionApplication({
          applicationId: candidate.applicationId,
          toState,
          actor: "recruiter",
          rationale: parsed.rationale,
          disposition:
            toState === "rejected"
              ? { code: "OVERRIDE_REJECTED", description: parsed.rationale ?? "" }
              : undefined,
        });

        // Best-effort, exactly as the single-candidate paths treat it: a
        // delivery failure must not undo a recorded transition. It is reported
        // as a succeeded transition with a note, not as a failure — because the
        // state change is what did happen.
        try {
          await sendTransitionNotification(candidate.applicationId, toState, userId);
        } catch (err) {
          console.error(
            "bulk action: candidate notification failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      touchedCampaigns.add(candidate.campaignId);
      outcomes.push({
        applicationId: candidate.applicationId,
        name: candidate.name,
        status: "succeeded",
        detail: null,
        toState: entry.toState,
      });
    } catch (err) {
      // One failure must not abandon the rest of the batch — the recruiter
      // would have no way to tell which half ran.
      outcomes.push({
        applicationId: candidate.applicationId,
        name: candidate.name,
        status: "failed",
        detail: err instanceof Error ? err.message : "Action failed.",
        toState: null,
      });
    }
  }

  for (const campaignId of touchedCampaigns) {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/candidates`);
  }
  if (parsed.action === "talent_pool") revalidatePath("/candidates");

  return summarizeBulkResult(parsed.action, outcomes);
}
