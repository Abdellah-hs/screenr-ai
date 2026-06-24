"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Campaign, CampaignStatus } from "@/lib/constants";
import {
  parseCampaignFormData,
  uuidSchema,
  campaignStatusSchema,
  campaignIdsSchema,
} from "@/lib/validations";
import { requireUserId } from "@/lib/auth/guards";

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
} from "@/lib/data/campaigns";

// ─── GET all campaigns ───────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  const userId = await requireUserId();
  return fetchAllCampaigns(userId);
}

// ─── GET single campaign ─────────────────────────────────────────────────────

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const userId = await requireUserId();
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
    title, description, department, positions, status, deadline, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona, application_email: applicationEmail,
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
      deadline: deadline ? new Date(deadline).toISOString() : null,
      location,
      automation_mode: automationMode,
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
      application_email: applicationEmail,
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
  status: CampaignStatus
) {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);
  const toStatus = campaignStatusSchema.parse(status);

  // Campaign status is freely settable (no transition graph); we read the
  // current status only to record the old → new pair in the audit log.
  const fromStatus = await fetchCampaignStatus(campaignId, userId);
  if (!fromStatus) throw new Error("Campaign not found");

  await updateCampaignStatusTx(campaignId, fromStatus, toStatus, userId);

  revalidatePath(`/campaigns/${campaignId}`);
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

  revalidatePath("/campaigns");
}

// ─── UPDATE campaign ─────────────────────────────────────────────────────────

export async function updateCampaign(id: string, formData: FormData) {
  const userId = await requireUserId();

  uuidSchema.parse(id);

  // Validate all inputs
  const {
    title, description, department, positions, status, deadline, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona, application_email: applicationEmail,
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
      deadline: deadline ? new Date(deadline).toISOString() : null,
      location,
      automation_mode: automationMode,
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
      application_email: applicationEmail,
      interview_slot_minutes: interviewSlotMinutes,
      interview_timezone: interviewTimezone,
      interview_booking_horizon_days: interviewBookingHorizonDays,
    },
    rubrics,
    slaTimers,
    availabilityRules,
    userId
  );

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
