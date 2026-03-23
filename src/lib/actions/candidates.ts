"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  CANDIDATE_STAGE_TRANSITIONS,
  type Candidate,
  type CandidateStage,
  type CandidateScore,
  type ScoreFactor,
  type ScreeningCriterion,
  type EvaluationRubric,
  type ScreeningTier,
} from "@/lib/constants";
import type { Json } from "@/types/database.types";
import { scoreResumeWithAI } from "@/lib/actions/ai-resume";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCandidate(row: any, scores: any[] = []): Candidate {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    current_title: row.current_title ?? null,
    current_company: row.current_company ?? null,
    stage: row.stage as CandidateStage,
    resume: (row.resume ?? { skills: [], experience_years: 0, education: "" }) as Candidate["resume"],
    resume_url: row.resume_url ?? null,
    resume_text: row.resume_text ?? null,
    applied_at: row.applied_at,
    updated_at: row.updated_at,
    scores: scores.map((s) => ({
      stage: s.stage as CandidateScore["stage"],
      overall: s.overall,
      tier: (s.tier ?? undefined) as ScreeningTier | undefined,
      ai_summary: s.ai_summary,
      factors: (s.factors ?? []) as ScoreFactor[],
      scored_at: s.scored_at,
    })),
  };
}

export async function getCandidatesByCampaignId(
  campaignId: string
): Promise<Candidate[]> {
  const supabase = await createClient();

  const { data: candidates, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("applied_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!candidates || candidates.length === 0) return [];

  // Fetch all scores for these candidates in one query
  const candidateIds = candidates.map((c) => c.id);
  const { data: allScores } = await supabase
    .from("candidate_scores")
    .select("*")
    .in("candidate_id", candidateIds)
    .order("scored_at", { ascending: true });

  const scoresByCandidate = new Map<string, typeof allScores>();
  for (const score of allScores ?? []) {
    const existing = scoresByCandidate.get(score.candidate_id) ?? [];
    existing.push(score);
    scoresByCandidate.set(score.candidate_id, existing);
  }

  return candidates.map((c) =>
    rowToCandidate(c, scoresByCandidate.get(c.id) ?? [])
  );
}

export async function getCandidateById(
  id: string
): Promise<Candidate | null> {
  const supabase = await createClient();

  const { data: candidate, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !candidate) return null;

  const { data: scores } = await supabase
    .from("candidate_scores")
    .select("*")
    .eq("candidate_id", id)
    .order("scored_at", { ascending: true });

  return rowToCandidate(candidate, scores ?? []);
}

export async function updateCandidateStage(
  id: string,
  newStage: CandidateStage
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: candidate, error: fetchError } = await supabase
    .from("candidates")
    .select("stage, campaign_id")
    .eq("id", id)
    .single();

  if (fetchError || !candidate) return { error: "Candidate not found" };

  const currentStage = candidate.stage as CandidateStage;
  const allowed = CANDIDATE_STAGE_TRANSITIONS[currentStage];
  if (!allowed.includes(newStage)) {
    return { error: `Cannot move from ${currentStage} to ${newStage}` };
  }

  const { error: updateError } = await supabase
    .from("candidates")
    .update({ stage: newStage, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) return { error: updateError.message };

  revalidatePath(`/campaigns/${candidate.campaign_id}`);
  return {};
}

export async function createCandidate(
  campaignId: string,
  formData: FormData
): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = (formData.get("phone") as string) || null;
  const currentTitle = (formData.get("current_title") as string) || null;
  const currentCompany = (formData.get("current_company") as string) || null;
  const resumeUrl = (formData.get("resume_url") as string) || null;
  const resumeText = (formData.get("resume_text") as string) || null;
  const resumeJson = formData.get("resume_json") as string;

  let resume = { skills: [] as string[], experience_years: 0, education: "" };
  try {
    if (resumeJson) resume = JSON.parse(resumeJson);
  } catch {
    /* keep default */
  }

  const { data, error } = await supabase
    .from("candidates")
    .insert({
      campaign_id: campaignId,
      name,
      email,
      phone,
      current_title: currentTitle,
      current_company: currentCompany,
      resume_url: resumeUrl,
      resume_text: resumeText,
      resume: resume as unknown as Json,
      stage: "applied",
      user_id: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/campaigns/${campaignId}/candidates`);
  return { id: data.id };
}

export async function screenCandidate(
  candidateId: string
): Promise<{
  score: CandidateScore;
  autoAction: "advanced" | "rejected" | "none";
}> {
  const supabase = await createClient();

  // Fetch candidate
  const { data: candidate, error: candErr } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", candidateId)
    .single();
  if (candErr || !candidate) throw new Error("Candidate not found");
  if (!candidate.resume_text)
    throw new Error("No resume text available for screening");

  // Fetch campaign
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", candidate.campaign_id)
    .single();
  if (campErr || !campaign) throw new Error("Campaign not found");

  // Call AI scoring
  const result = await scoreResumeWithAI(candidate.resume_text, {
    title: campaign.title,
    description: campaign.description,
    screening_criteria: (campaign.screening_criteria ?? []) as unknown as ScreeningCriterion[],
    rubrics: (campaign.rubrics ?? []) as unknown as EvaluationRubric[],
    screening_threshold: campaign.screening_threshold,
  });

  // Insert score
  const { error: scoreErr } = await supabase
    .from("candidate_scores")
    .insert({
      candidate_id: candidateId,
      stage: "resume",
      overall: result.overall,
      tier: result.tier,
      ai_summary: result.ai_summary,
      factors: result.factors as unknown as Json,
    });
  if (scoreErr) throw new Error(scoreErr.message);

  // Auto-advance/reject based on automation mode
  let autoAction: "advanced" | "rejected" | "none" = "none";
  if (campaign.automation_mode === "fully_auto") {
    const newStage =
      result.overall >= campaign.screening_threshold
        ? "screening"
        : "rejected";
    autoAction =
      result.overall >= campaign.screening_threshold
        ? "advanced"
        : "rejected";

    await supabase
      .from("candidates")
      .update({
        stage: newStage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidateId);
  }

  revalidatePath(`/campaigns/${candidate.campaign_id}`);

  return {
    score: {
      stage: "resume",
      overall: result.overall,
      tier: result.tier,
      ai_summary: result.ai_summary,
      factors: result.factors,
      scored_at: new Date().toISOString(),
    },
    autoAction,
  };
}
