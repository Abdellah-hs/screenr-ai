"use server";

import { redirect } from "next/navigation";
import type { Campaign } from "@/lib/constants";
import { parseCampaignFormData, uuidSchema } from "@/lib/validations";
import { requireUserId } from "@/lib/auth/guards";

import {
  fetchAllCampaigns,
  fetchCampaignById,
  insertCampaignTx,
  updateCampaignTx,
  cloneCampaignTx,
  fetchCampaignScoringConfig,
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
    interview_persona: interviewPersona,
    rubrics, slaTimers, reviewers
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
    },
    rubrics,
    slaTimers,
    reviewers,
    userId
  );

  redirect(`/campaigns/${campaignId}`);
}

// ─── UPDATE campaign ─────────────────────────────────────────────────────────

export async function updateCampaign(id: string, formData: FormData) {
  const userId = await requireUserId();

  uuidSchema.parse(id);

  // Validate all inputs
  const {
    title, description, department, positions, status, deadline, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    rubrics, slaTimers
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
    },
    rubrics,
    slaTimers,
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
