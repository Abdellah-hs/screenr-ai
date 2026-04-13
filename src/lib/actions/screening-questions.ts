"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  uuidSchema,
  screeningQuestionsArraySchema,
} from "@/lib/validations";
import { generateQuestionsForRole } from "@/lib/services/screening-questions";
import { fetchCampaignScoringConfig } from "@/lib/data/campaigns";
import {
  fetchScreeningQuestionsByCampaignId,
  replaceScreeningQuestions,
  type ScreeningQuestionRow,
} from "@/lib/data/screening-questions";

async function requireCampaignOwner(campaignId: string) {
  uuidSchema.parse(campaignId);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();

  if (!campaign) throw new Error("Campaign not found or access denied");
  return user;
}

export async function getScreeningQuestions(
  campaignId: string
): Promise<ScreeningQuestionRow[]> {
  await requireCampaignOwner(campaignId);
  return fetchScreeningQuestionsByCampaignId(campaignId);
}

/**
 * AI-generate a fresh set of screening questions for a campaign. Does not persist.
 * The UI shows them in the editor so the recruiter can tweak before saving.
 */
export async function generateScreeningQuestions(
  campaignId: string
): Promise<{ prompt: string; is_required: boolean }[]> {
  const user = await requireCampaignOwner(campaignId);

  // Reuse the AI generation bucket — same OpenAI quota concern applies.
  checkRateLimit(user.id, {
    name: "ai-generate",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  const config = await fetchCampaignScoringConfig(campaignId);
  if (!config) throw new Error("Campaign not found");
  if (!config.description || config.description.trim().length < 10) {
    throw new Error(
      "Add a job description to the campaign before generating screening questions."
    );
  }

  return generateQuestionsForRole({
    jobDescription: config.description,
    screeningCriteria: config.screening_criteria,
    count: 5,
  });
}

/**
 * Persist an edited set of screening questions for a campaign. Replaces the whole set.
 */
export async function saveScreeningQuestions(
  campaignId: string,
  questions: { id?: string; prompt: string; is_required: boolean }[]
): Promise<void> {
  await requireCampaignOwner(campaignId);

  const validated = screeningQuestionsArraySchema.parse(questions);

  await replaceScreeningQuestions(
    campaignId,
    validated.map((q) => ({ prompt: q.prompt, is_required: q.is_required }))
  );

  revalidatePath(`/campaigns/${campaignId}`);
}
