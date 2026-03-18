"use server";

import { redirect } from "next/navigation";
import {
  getCampaignByIdFromMock,
  getActiveCampaignsFromMock,
  updateCampaignInMock,
  createCampaignInMock,
  type CampaignStatus,
  type Campaign,
  type ScreeningCriterion,
  type EvaluationRubric,
} from "@/lib/constants";

export async function createCampaign(formData: FormData) {
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const department = (formData.get("department") as string) || null;
  const positions = parseInt(formData.get("positions") as string) || 1;
  const status = (formData.get("status") as CampaignStatus) || "draft";
  const deadline = (formData.get("deadline") as string) || null;
  const location = (formData.get("location") as string) || null;

  // Parse screening criteria and rubrics from JSON hidden inputs
  const screeningCriteriaJson = formData.get("screening_criteria_json") as string;
  const rubicsJson = formData.get("rubrics_json") as string;

  let screeningCriteria: ScreeningCriterion[] = [];
  let rubrics: EvaluationRubric[] = [];

  try {
    if (screeningCriteriaJson) screeningCriteria = JSON.parse(screeningCriteriaJson);
  } catch { /* keep empty */ }

  try {
    if (rubicsJson) rubrics = JSON.parse(rubicsJson);
  } catch { /* keep empty */ }

  const campaignId = `camp-${Math.random().toString(36).substr(2, 9)}`;

  // Assign campaign_id to rubrics
  rubrics = rubrics.map((r) => ({ ...r, campaign_id: campaignId }));

  const newCampaign: Campaign = {
    id: campaignId,
    title,
    description,
    department,
    positions,
    status,
    deadline,
    location,
    timezone: "UTC",
    automation_mode: "human_in_loop",
    screening_threshold: 70,
    interview_persona: "neutral",
    screening_criteria: screeningCriteria,
    rubrics,
    reviewers: [],
    sla_timers: [],
    pipeline: [
      { name: "Applied", key: "applied", count: 0 },
      { name: "Screening", key: "screening", count: 0 },
      { name: "Interview", key: "interview", count: 0 },
      { name: "Offer", key: "offer", count: 0 },
      { name: "Hired", key: "hired", count: 0 },
    ],
    user_id: "user-001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  createCampaignInMock(newCampaign);
  redirect(`/campaigns/${newCampaign.id}`);
}

export async function getCampaigns(): Promise<Campaign[]> {
  return getActiveCampaignsFromMock();
}

export async function updateCampaign(id: string, formData: FormData) {
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const department = (formData.get("department") as string) || null;
  const positions = parseInt(formData.get("positions") as string) || 1;
  const status = (formData.get("status") as CampaignStatus) || "draft";
  const deadline = (formData.get("deadline") as string) || null;
  const location = (formData.get("location") as string) || null;

  // Parse screening criteria and rubrics from JSON hidden inputs
  const screeningCriteriaJson = formData.get("screening_criteria_json") as string;
  const rubicsJson = formData.get("rubrics_json") as string;

  let screeningCriteria: ScreeningCriterion[] | undefined;
  let rubrics: EvaluationRubric[] | undefined;

  try {
    if (screeningCriteriaJson) screeningCriteria = JSON.parse(screeningCriteriaJson);
  } catch { /* keep undefined */ }

  try {
    if (rubicsJson) {
      rubrics = JSON.parse(rubicsJson);
      rubrics = rubrics!.map((r) => ({ ...r, campaign_id: id }));
    }
  } catch { /* keep undefined */ }

  updateCampaignInMock(id, {
    title,
    description,
    department,
    positions,
    status,
    deadline,
    location,
    ...(screeningCriteria !== undefined && { screening_criteria: screeningCriteria }),
    ...(rubrics !== undefined && { rubrics }),
    updated_at: new Date().toISOString(),
  });

  redirect(`/campaigns/${id}`);
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  return getCampaignByIdFromMock(id) ?? null;
}
