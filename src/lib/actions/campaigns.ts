"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Campaign, CampaignStatus, CampaignStatusSelection } from "@/lib/constants";
import {
  parseCampaignFormData,
  uuidSchema,
  campaignStatusSchema,
  campaignStatusSelectionSchema,
  campaignIdsSchema,
} from "@/lib/validations";
import { decodeStatusSelection } from "@/lib/rules/campaign-status";
import { requireUserId } from "@/lib/auth/guards";
import { scoreUnscoredCampaignCandidates } from "./candidates";

import {
  fetchAllCampaigns,
  fetchCampaignById,
  insertCampaignTx,
  updateCampaignTx,
  cloneCampaignTx,
  fetchCampaignScoringConfig,
  fetchCampaignStatus,
  updateCampaignStatusTx,
  softDeleteCampaignTx,
  restoreCampaignTx,
} from "@/lib/data/campaigns";

// ─── GET all campaigns ───────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  const userId = await requireUserId();
  return fetchAllCampaigns(userId);
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

export async function createCampaign(formData: FormData) {
  const userId = await requireUserId();

  // Validate all inputs
  const {
    title, description, department, positions, status,
    accepting_applications: acceptingApplications,
    deadline, deadline_enforced: deadlineEnforced, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    interview_slot_minutes: interviewSlotMinutes, interview_timezone: interviewTimezone,
    interview_booking_horizon_days: interviewBookingHorizonDays,
    rubrics, slaTimers, reviewers, availabilityRules
  } = parseCampaignFormData(formData);

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
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
      interview_slot_minutes: interviewSlotMinutes,
      interview_timezone: interviewTimezone,
      interview_booking_horizon_days: interviewBookingHorizonDays,
    },
    rubrics,
    slaTimers,
    reviewers,
    availabilityRules,
    userId
  );

  redirect(`/campaigns/${campaignId}`);
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

export async function updateCampaign(id: string, formData: FormData) {
  const userId = await requireUserId();

  uuidSchema.parse(id);

  // Validate all inputs
  const {
    title, description, department, positions, status,
    accepting_applications: acceptingApplications,
    deadline, deadline_enforced: deadlineEnforced, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    interview_slot_minutes: interviewSlotMinutes, interview_timezone: interviewTimezone,
    interview_booking_horizon_days: interviewBookingHorizonDays,
    rubrics, slaTimers, availabilityRules
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

  // Criteria/rubric may have just been added or changed — score any candidate
  // that doesn't have a resume score yet (the automatic replacement for the old
  // manual "Score Resume" button). Best-effort: a scoring failure must never
  // block the campaign save.
  try {
    await scoreUnscoredCampaignCandidates(id, userId);
  } catch (err) {
    console.error("Post-save candidate scoring failed (non-blocking):", err);
  }

  // The redirect refreshes the campaign page, but rubric/threshold/status
  // changes also surface on the candidate detail pages beneath it (stale-
  // rubric badge, freeze-gated controls) — revalidate the whole subtree.
  revalidatePath(`/campaigns/${id}`, "layout");

  redirect(`/campaigns/${id}`);
}

// ─── CLONE campaign ──────────────────────────────────────────────────────────

export async function cloneCampaign(id: string) {
  const userId = await requireUserId();

  const source = await fetchCampaignById(id, userId);
  if (!source) throw new Error("Campaign not found");

  const clonedId = await cloneCampaignTx(id, source, userId);

  redirect(`/campaigns/${clonedId}`);
}
