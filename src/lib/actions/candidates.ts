"use server";

import {
  getCandidatesByCampaign,
  getCandidateByIdFromMock,
  updateCandidateInMock,
  type Candidate,
  type CandidateStage,
} from "@/lib/constants";

export async function getCandidatesByCampaignId(
  campaignId: string
): Promise<Candidate[]> {
  return getCandidatesByCampaign(campaignId);
}

export async function getCandidateById(
  id: string
): Promise<Candidate | null> {
  return getCandidateByIdFromMock(id) ?? null;
}

export async function updateCandidateStage(
  id: string,
  stage: CandidateStage
) {
  updateCandidateInMock(id, {
    stage,
    updated_at: new Date().toISOString(),
  });
}
