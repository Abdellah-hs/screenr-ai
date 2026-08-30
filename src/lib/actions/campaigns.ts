"use server";

import { z } from "zod/v4";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Campaign, CampaignStatus, CampaignStatusSelection } from "@/lib/constants";
import {
  parseCampaignFormData,
  uuidSchema,
  campaignStatusSchema,
  campaignStatusSelectionSchema,
  campaignIdsSchema,
  rubricSchema,
} from "@/lib/validations";
import {
  decodeStatusSelection,
  applyGateBlocker,
  type ApplyGateBlocker,
} from "@/lib/rules/campaign-status";
import { isTeamReviewersEnabled } from "@/lib/flags";
import { requireUserId } from "@/lib/auth/guards";
import { scoreUnscoredCampaignCandidates } from "./candidates";

import {
  fetchAllCampaigns,
  fetchCampaignById,
  insertCampaignTx,
  updateCampaignTx,
  updateCampaignRubricsTx,
  cloneCampaignTx,
  fetchCampaignScoringConfig,
  fetchCampaignStatus,
  updateCampaignStatusTx,
  softDeleteCampaignTx,
  restoreCampaignTx,
  fetchCampaignBoardApplications,
  fetchScreeningQuestionCounts,
} from "@/lib/data/campaigns";
import {
  fetchScreeningQuestionsByCampaignId,
  replaceScreeningQuestions,
} from "@/lib/data/screening-questions";
import {
  summariseCampaign,
  type BoardApplication,
  type CampaignBoardSummary,
} from "@/lib/campaigns/board-view";

// ─── GET all campaigns ───────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  const userId = await requireUserId();
  return fetchAllCampaigns(userId);
}

// ─── GET campaigns + their board summaries ───────────────────────────────────

export interface CampaignBoard {
  campaigns: Campaign[];
  /** Keyed by campaign id. A campaign with no applications is absent. */
  summaries: Record<string, CampaignBoardSummary>;
  /** Keyed by campaign id: which intake gate is shut, null when the apply link
   *  is live. Computed here rather than in the list component because one gate
   *  is a deadline, and a client component reading its own clock would render a
   *  different answer than the server did. */
  applyBlockers: Record<string, ApplyGateBlocker | null>;
}

/**
 * The campaigns list, with the pipeline shape and waiting work each row shows.
 *
 * `Campaign.pipeline` is a static placeholder (`DEFAULT_PIPELINE`), so the list
 * had no real counts to draw and fell back to a "Show candidates" link that
 * said nothing about whether opening it was worth doing. Three queries answer
 * the whole board.
 */
export async function getCampaignBoard(): Promise<CampaignBoard> {
  const userId = await requireUserId();
  const [campaigns, applications, questionCounts] = await Promise.all([
    fetchAllCampaigns(userId),
    fetchCampaignBoardApplications(userId),
    fetchScreeningQuestionCounts(userId),
  ]);

  const byCampaign = new Map<string, BoardApplication[]>();
  for (const app of applications) {
    const existing = byCampaign.get(app.campaignId);
    if (existing) existing.push(app);
    else byCampaign.set(app.campaignId, [app]);
  }

  // One clock for the whole board, so two rows with the same deadline can
  // never disagree about whether it has passed.
  const now = new Date();
  const summaries: Record<string, CampaignBoardSummary> = {};
  const applyBlockers: Record<string, ApplyGateBlocker | null> = {};
  for (const campaign of campaigns) {
    summaries[campaign.id] = summariseCampaign(byCampaign.get(campaign.id) ?? [], {
      status: campaign.status ?? "draft",
      slaTimers: campaign.sla_timers,
      screeningQuestionCount: questionCounts[campaign.id] ?? 0,
    });
    applyBlockers[campaign.id] = applyGateBlocker(campaign, now);
  }

  return { campaigns, summaries, applyBlockers };
}

// ─── GET single campaign ─────────────────────────────────────────────────────

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const userId = await requireUserId();
  // A malformed id (e.g. a literal "undefined" in the URL) is a plain
  // not-found — don't send garbage uuids to the database.
  if (!uuidSchema.safeParse(id).success) return null;
  return fetchCampaignById(id, userId);
}

// ─── Resume scoring criteria count ───────────────────────────────────────────
// Resume scoring grades a CV against the campaign's active "resume" rubric
// dimensions. Zero criteria → scoring is skipped (no score). The candidate UI
// uses this to explain the absence of a score instead of failing silently.

export async function getResumeCriteriaCount(campaignId: string): Promise<number> {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);
  const config = await fetchCampaignScoringConfig(campaignId, userId);
  return config?.screening_criteria.length ?? 0;
}

// ─── CREATE campaign ─────────────────────────────────────────────────────────

/**
 * Where a finished create lands.
 *
 * `share` is the wizard's Create button: the campaign now exists, so its apply
 * link exists, and the one thing a recruiter needs next is that link and
 * something to post it with. `campaign` is every other route in — chiefly
 * "Save draft", which is a recruiter saying "I will finish this later" and must
 * not be answered with a page urging them to share it.
 */
export type CreateCampaignFinish = "campaign" | "share";

export async function createCampaign(
  formData: FormData,
  finish: CreateCampaignFinish = "campaign",
) {
  const userId = await requireUserId();

  // Validate all inputs
  const {
    title, description, department, positions, status,
    accepting_applications: acceptingApplications,
    deadline, deadline_enforced: deadlineEnforced, location,
    automation_mode: automationMode,
    resume_threshold: resumeThreshold, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    interview_slot_minutes: interviewSlotMinutes, interview_timezone: interviewTimezone,
    interview_booking_horizon_days: interviewBookingHorizonDays,
    rubrics, slaTimers, reviewers, availabilityRules, screeningQuestions
  } = parseCampaignFormData(formData);

  // Hiding the editor removes the hidden input, but a form field is a
  // suggestion, not a guard — a hand-built post would still write placeholder
  // `user-temp-*` reviewers into a table nothing reads. The flag has to hold
  // here too, or it only hides the mess instead of preventing it.
  const teamReviewers = isTeamReviewersEnabled() ? reviewers : [];

  const campaignId = await insertCampaignTx(
    {
      title,
      description,
      department,
      positions,
      status,
      accepting_applications: acceptingApplications,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      deadline_enforced: deadlineEnforced,
      location,
      automation_mode: automationMode,
      resume_threshold: resumeThreshold,
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
      interview_slot_minutes: interviewSlotMinutes,
      interview_timezone: interviewTimezone,
      interview_booking_horizon_days: interviewBookingHorizonDays,
    },
    rubrics,
    slaTimers,
    teamReviewers,
    availabilityRules,
    // Written in the same transaction as the campaign so a new campaign is
    // never born unable to approve anyone into screening. Empty is still
    // allowed — the detail-page banner remains the safety net for that.
    (screeningQuestions ?? []).map((q) => ({ prompt: q.prompt })),
    userId
  );

  redirect(
    finish === "share"
      ? `/campaigns/${campaignId}/share`
      : `/campaigns/${campaignId}`,
  );
}

// ─── UPDATE campaign status (inline, outside the edit form) ──────────────────
// A quick status flip from the campaign detail page. Reads the current status,
// lets the rule layer veto an illegal transition, then persists + revalidates.

export async function updateCampaignStatus(
  campaignId: string,
  selection: CampaignStatusSelection
) {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);
  // The inline changer sends a 5-option selection; decode it into the lifecycle
  // status + the intake switch, so "Active — not accepting" works from the list.
  const validSelection = campaignStatusSelectionSchema.parse(selection);
  const { status: toStatus, accepting_applications } = decodeStatusSelection(validSelection);

  // Campaign status is freely settable (no transition graph); we read the
  // current status only to record the old → new pair in the audit log.
  const fromStatus = await fetchCampaignStatus(campaignId, userId);
  if (!fromStatus) throw new Error("Campaign not found");

  await updateCampaignStatusTx(campaignId, fromStatus, toStatus, userId, accepting_applications);

  // Status drives the freeze rule on every candidate detail page under this
  // campaign (approve / send / re-score buttons), so revalidate the subtree,
  // not just the campaign page.
  revalidatePath(`/campaigns/${campaignId}`, "layout");
  revalidatePath("/campaigns");
}

// ─── DELETE campaign (soft) ──────────────────────────────────────────────────
// The "Remove" row action. Soft-deletes so the campaign vanishes from the list
// while its candidates/scores/audit trail survive. revalidates the list.

export async function deleteCampaign(campaignId: string) {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);

  await softDeleteCampaignTx(campaignId, userId);

  revalidatePath("/campaigns");
}

// ─── RESTORE campaign (undo soft delete) ─────────────────────────────────────
// The Talent Pool's "Restore" action for a removed campaign. Clears the
// campaign's `deleted_at` so it — and the normal candidate click-through under
// it — reappears. Revalidates both the campaign list and the Talent Pool.

export async function restoreCampaign(campaignId: string) {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);

  await restoreCampaignTx(campaignId, userId);

  revalidatePath("/campaigns");
  revalidatePath("/candidates");
}

// ─── BULK row actions (list multi-select) ────────────────────────────────────
// Both orchestrate the single-campaign data helpers so ownership scoping, audit
// rows and the transition graph behave exactly as the per-row actions do.

export async function deleteCampaigns(campaignIds: string[]) {
  const userId = await requireUserId();
  const ids = campaignIdsSchema.parse(campaignIds);

  await Promise.all(ids.map((id) => softDeleteCampaignTx(id, userId)));

  revalidatePath("/campaigns");
}

export async function updateCampaignsStatus(
  campaignIds: string[],
  status: CampaignStatus
) {
  const userId = await requireUserId();
  const ids = campaignIdsSchema.parse(campaignIds);
  const toStatus = campaignStatusSchema.parse(status);

  // Pass 1: read every current status (for the audit log) and confirm each
  // campaign exists / is owned before mutating anything, so a bad id in the
  // selection fails the whole batch rather than half-applying.
  const froms = await Promise.all(
    ids.map((id) => fetchCampaignStatus(id, userId))
  );
  const plan = ids.map((id, i) => {
    const fromStatus = froms[i];
    if (!fromStatus) throw new Error("Campaign not found");
    return { id, fromStatus };
  });

  // Pass 2: apply. Status is freely settable, so any target is allowed.
  await Promise.all(
    plan.map((p) => updateCampaignStatusTx(p.id, p.fromStatus, toStatus, userId))
  );

  // Same subtree rule as the single-campaign status change: candidate pages
  // under each campaign render freeze-gated controls off this status.
  for (const p of plan) {
    revalidatePath(`/campaigns/${p.id}`, "layout");
  }
  revalidatePath("/campaigns");
}

// ─── UPDATE campaign ─────────────────────────────────────────────────────────

/**
 * Persist an edited question set, but only if it is actually different.
 *
 * Compared by prompt and order, which is the whole of what a question is —
 * ids are the store's, not the recruiter's, and the wizard sends prompts only.
 */
async function replaceScreeningQuestionsIfChanged(
  campaignId: string,
  questions: { prompt: string }[]
): Promise<boolean> {
  const existing = await fetchScreeningQuestionsByCampaignId(campaignId);
  const before = existing.map((q) => q.prompt);
  const after = questions.map((q) => q.prompt);

  if (before.length === after.length && before.every((p, i) => p === after[i])) {
    return false;
  }

  await replaceScreeningQuestions(campaignId, questions);
  return true;
}

export async function updateCampaign(id: string, formData: FormData) {
  const userId = await requireUserId();

  uuidSchema.parse(id);

  // Validate all inputs
  const {
    title, description, department, positions, status,
    accepting_applications: acceptingApplications,
    deadline, deadline_enforced: deadlineEnforced, location,
    automation_mode: automationMode,
    resume_threshold: resumeThreshold, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    interview_slot_minutes: interviewSlotMinutes, interview_timezone: interviewTimezone,
    interview_booking_horizon_days: interviewBookingHorizonDays,
    rubrics, slaTimers, availabilityRules, screeningQuestions
  } = parseCampaignFormData(formData);

  await updateCampaignTx(
    id,
    {
      title,
      description,
      department,
      positions,
      status,
      accepting_applications: acceptingApplications,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      deadline_enforced: deadlineEnforced,
      location,
      automation_mode: automationMode,
      resume_threshold: resumeThreshold,
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
      interview_slot_minutes: interviewSlotMinutes,
      interview_timezone: interviewTimezone,
      interview_booking_horizon_days: interviewBookingHorizonDays,
    },
    rubrics,
    slaTimers,
    availabilityRules,
    userId
  );

  // Screening questions ride along with the rest of the form now that editing
  // walks the same wizard as creating — leaving them out was what forced the
  // old edit page to point at another page instead of holding the section.
  //
  // Only when they actually differ. `replaceScreeningQuestions` wipes and
  // re-inserts, so saving an unrelated field (a location typo) would otherwise
  // mint new question ids on every save, orphaning the `question_id` snapshots
  // already recorded on candidates' in-flight responses.
  if (screeningQuestions) {
    await replaceScreeningQuestionsIfChanged(id, screeningQuestions);
  }

  // Criteria/rubric may have just been added or changed — score any candidate
  // that doesn't have a resume score yet (the automatic replacement for the old
  // manual "Score Resume" button). Best-effort: a scoring failure must never
  // block the campaign save.
  try {
    await scoreUnscoredCampaignCandidates(id);
  } catch (err) {
    console.error("Post-save candidate scoring failed (non-blocking):", err);
  }

  // The redirect refreshes the campaign page, but rubric/threshold/status
  // changes also surface on the candidate detail pages beneath it (stale-
  // rubric badge, freeze-gated controls) — revalidate the whole subtree.
  revalidatePath(`/campaigns/${id}`, "layout");

  redirect(`/campaigns/${id}`);
}

// ─── SAVE rubrics only (in place, from the campaign page) ────────────────────

/**
 * What the recruiter is editing when they press "Edit rubric".
 *
 * Deliberately narrow. `updateCampaign` posts the entire campaign — title,
 * thresholds, timers, availability, screening questions — because the wizard
 * has all of it on screen. Reaching for that to change one criterion means a
 * whole campaign's worth of fields is in play for a one-word edit, and the
 * recruiter has to leave the page showing them the rubric to do it.
 */
export async function saveCampaignRubrics(
  campaignId: string,
  rubrics: unknown,
): Promise<void> {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);

  const parsed = z.array(rubricSchema).safeParse(rubrics);
  if (!parsed.success) {
    // The editor blocks an unnamed dimension before it gets here; this is the
    // backstop, and it says which rule was broken rather than printing a Zod
    // path at a recruiter.
    throw new Error("Every rubric dimension needs a name before it can be saved.");
  }

  // Position is the order the recruiter arranged, and for the resume stage it
  // is load-bearing: extracted evidence comes back index-aligned to this list.
  // The editor stamps every new row `sort_order: 0`, so it is re-derived here
  // rather than trusted — a client that cannot get it wrong is better than one
  // that is asked not to.
  const ordered = parsed.data.map((rubric) => ({
    ...rubric,
    dimensions: rubric.dimensions.map((dimension, index) => ({
      ...dimension,
      name: dimension.name.trim(),
      sort_order: index,
    })),
  }));

  await updateCampaignRubricsTx(campaignId, ordered, userId);

  // Same reason `updateCampaign` does it: the criteria a candidate is measured
  // against may have just appeared. Best-effort — a scoring failure must never
  // lose the recruiter's rubric edit.
  try {
    await scoreUnscoredCampaignCandidates(campaignId);
  } catch (err) {
    console.error("Post-rubric-save candidate scoring failed (non-blocking):", err);
  }

  // "layout", not the page: the stale-rubric badge on every candidate file
  // beneath this campaign is derived from the active rubric version.
  revalidatePath(`/campaigns/${campaignId}`, "layout");
}

// ─── CLONE campaign ──────────────────────────────────────────────────────────

export async function cloneCampaign(id: string) {
  const userId = await requireUserId();

  const source = await fetchCampaignById(id, userId);
  if (!source) throw new Error("Campaign not found");

  const clonedId = await cloneCampaignTx(id, source, userId);

  redirect(`/campaigns/${clonedId}`);
}
