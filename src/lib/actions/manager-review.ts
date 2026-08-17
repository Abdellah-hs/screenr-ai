"use server";

import { revalidatePath } from "next/cache";
import { managerReviewDecisionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { transitionApplication } from "@/lib/data/transitions";
import { fetchCandidateById } from "@/lib/data/candidates";
import {
  assertReviewable,
  managerDecisionDisposition,
  managerDecisionTarget,
  type ManagerRejectionCode,
  type ManagerReviewDecision,
} from "@/lib/rules/manager-review";
import { sendTransitionNotification } from "./transition-notifications";
import type { ApplicationState } from "@/lib/constants";

/**
 * The manager's decision point — the last human step in the pipeline.
 *
 * Everything upstream of this is machine work that stops deliberately:
 * `evaluateInterviewScoringOutcome` records a score and advances no further,
 * because the PRD wants a person weighing stage evidence rather than a rollup
 * threshold deciding who gets hired. Until this action existed there was no way
 * to act on that evidence except editing the database by hand.
 *
 * Shaped after `decideHitlReview`, which is the same idea one stage earlier:
 * auth → validate → rate limit → ownership + state preflight → rule → transition
 * → notify. The rationale is mandatory and enforced twice, by the Zod schema
 * here and by `transitionApplication` for any `recruiter` actor, because a
 * decision with no recorded reason is the one thing an audit trail cannot
 * reconstruct later.
 */
export async function decideManagerReview(input: {
  applicationId: string;
  decision: ManagerReviewDecision;
  rationale: string;
  rejectionCode?: ManagerRejectionCode;
}): Promise<{ toState: ApplicationState }> {
  const userId = await requireUserId();

  const parsed = managerReviewDecisionSchema.parse(input);

  checkRateLimit(userId, {
    name: "manager-review",
    maxRequests: 30,
    windowMs: 5 * 60 * 1000,
  });

  // Ownership and freshness in one read: `fetchCandidateById` is scoped to the
  // recruiter's campaigns, so a missing row means "not yours" as much as "not
  // there", and either way the decision must not proceed.
  const application = await fetchCandidateById(parsed.applicationId, userId);
  if (!application) throw new Error("Application not found");

  // Deliberately NOT skipped for a same-state no-op: a stale tab deciding on an
  // already-decided application should hear about it, not silently succeed.
  assertReviewable(application.status as ApplicationState);

  const toState = managerDecisionTarget(parsed.decision);

  await transitionApplication({
    applicationId: parsed.applicationId,
    toState,
    actor: "recruiter",
    rationale: parsed.rationale,
    disposition: managerDecisionDisposition(
      parsed.decision,
      parsed.rejectionCode,
      parsed.rationale,
    ),
  });

  // Best-effort, exactly like the HITL path: the candidate email is a courtesy
  // and a delivery failure must not undo a recorded human decision. The
  // recruiter can resend; they cannot un-decide.
  try {
    await sendTransitionNotification(parsed.applicationId, toState, userId);
  } catch (err) {
    console.error(
      "manager review: candidate notification failed:",
      err instanceof Error ? err.message : err,
    );
  }

  revalidatePath(`/campaigns/${application.campaign_id}`);
  revalidatePath(
    `/campaigns/${application.campaign_id}/candidates/${parsed.applicationId}`,
  );

  return { toState };
}
