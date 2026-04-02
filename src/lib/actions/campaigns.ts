"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Campaign } from "@/lib/constants";
import { parseCampaignFormData, uuidSchema } from "@/lib/validations";

// Data Access
import {
  fetchAllCampaigns,
  fetchCampaignById,
  insertCampaignTx,
  updateCampaignTx,
  cloneCampaignTx,
} from "@/lib/data/campaigns";

// ─── GET all campaigns ───────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  return fetchAllCampaigns();
}

// ─── GET single campaign ─────────────────────────────────────────────────────

export async function getCampaignById(id: string): Promise<Campaign | null> {
  return fetchCampaignById(id);
}

// ─── CREATE campaign ─────────────────────────────────────────────────────────

export async function createCampaign(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Validate all inputs
  const {
    title, description, department, positions, status, deadline, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    screeningCriteria, rubrics, slaTimers, reviewers
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
    screeningCriteria,
    rubrics,
    slaTimers,
    reviewers,
    user.id
  );

  redirect(`/campaigns/${campaignId}`);
}

// ─── UPDATE campaign ─────────────────────────────────────────────────────────

export async function updateCampaign(id: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  uuidSchema.parse(id);

  // Validate all inputs
  const {
    title, description, department, positions, status, deadline, location,
    automation_mode: automationMode, screening_threshold: screeningThreshold,
    interview_persona: interviewPersona,
    screeningCriteria, slaTimers
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
    screeningCriteria,
    slaTimers,
    user.id
  );

  redirect(`/campaigns/${id}`);
}

// ─── CLONE campaign ──────────────────────────────────────────────────────────

export async function cloneCampaign(id: string) {
  const source = await getCampaignById(id);
  if (!source) throw new Error("Campaign not found");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const clonedId = await cloneCampaignTx(id, source, user.id);

  redirect(`/campaigns/${clonedId}`);
}
