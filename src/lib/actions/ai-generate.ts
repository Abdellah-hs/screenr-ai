"use server";

import type { ScreeningCriterion, EvaluationRubric } from "@/lib/constants";
import {
  aiDescriptionSchema,
  rubricDimensionSuggestionSchema,
  generateDescriptionSchema,
  socialPostSchema,
  type GenerateDescriptionInput,
  type SocialPostGenerationInput,
} from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import {
  generateScreeningCriteria as aiGenerateScreeningCriteria,
  generateRubricDimensions as aiGenerateRubricDimensions,
  generateJobDescription as aiGenerateJobDescription,
  generateSocialPosts as aiGenerateSocialPosts,
  type SocialPosts,
} from "@/lib/services/openai";
import { generateQuestionsForRole } from "@/lib/services/screening-questions";

const AI_GEN_LIMIT = { name: "ai-generate", maxRequests: 10, windowMs: 5 * 60 * 1000 };

export async function generateScreeningCriteria(
  description: string
): Promise<ScreeningCriterion[]> {
  const userId = await requireUserId();
  checkRateLimit(userId, AI_GEN_LIMIT);
  const validatedDescription = aiDescriptionSchema.parse(description);
  return aiGenerateScreeningCriteria(validatedDescription);
}

export async function generateRubricDimensions(
  description: string,
  campaignId: string
): Promise<EvaluationRubric[]> {
  const userId = await requireUserId();
  checkRateLimit(userId, AI_GEN_LIMIT);
  const validatedDescription = aiDescriptionSchema.parse(description);
  return aiGenerateRubricDimensions(validatedDescription, campaignId);
}

/**
 * Draft screening questions before the campaign row exists. This is the
 * create-wizard counterpart to `generateScreeningQuestions(campaignId)` in
 * `actions/screening-questions.ts`, which reads its inputs back out of the
 * database and so cannot run before the campaign is saved. Advisory only: it
 * returns questions for the recruiter to edit, and `createCampaign` persists
 * them.
 *
 * The rubric comes from the caller because the wizard is *holding* it — the
 * recruiter fills in the screening rubric on the same step, above this editor,
 * and it lives in the draft. It used to send an empty list on the grounds that
 * an unsaved campaign has no rubric to look up, which was true of the database
 * and false of the screen: the questions were drafted blind against the very
 * rubric their answers were about to be scored on.
 */
export async function generateScreeningQuestionsFromDescription(
  description: string,
  rubricDimensionNames: string[] = []
): Promise<{ prompt: string }[]> {
  const userId = await requireUserId();
  checkRateLimit(userId, AI_GEN_LIMIT);
  const validatedDescription = aiDescriptionSchema.parse(description);
  const names = rubricDimensionSuggestionSchema.parse(rubricDimensionNames);

  return generateQuestionsForRole({
    jobDescription: validatedDescription,
    rubricDimensions: names.map((name) => ({ name })),
  });
}

/**
 * Draft (or improve) a campaign description from recruiter-provided inputs.
 * Advisory only — returns text for the recruiter to edit and save; it never
 * writes to the campaign. Auth-guarded, rate-limited, and input-validated like
 * its siblings.
 */
export async function generateCampaignDescription(
  input: GenerateDescriptionInput
): Promise<{ text: string }> {
  const userId = await requireUserId();
  checkRateLimit(userId, AI_GEN_LIMIT);
  const validated = generateDescriptionSchema.parse(input);

  const text = await aiGenerateJobDescription({
    mode: validated.mode,
    title: validated.title,
    department: validated.department ?? null,
    location: validated.location ?? null,
    seniority: validated.seniority ?? null,
    employmentType: validated.employmentType ?? null,
    skills: validated.skills ?? [],
    companyContext: validated.companyContext ?? null,
    currentDraft: validated.currentDraft ?? null,
  });

  return { text };
}

/**
 * Draft "we're hiring" social copy (LinkedIn / X / Facebook / general) from
 * campaign data. Advisory only — returns text the recruiter edits and posts
 * manually; no publishing, no persistence. Auth-guarded, rate-limited, and
 * input-validated like its siblings.
 */
export async function generateSocialPosts(
  input: SocialPostGenerationInput
): Promise<SocialPosts> {
  const userId = await requireUserId();
  checkRateLimit(userId, AI_GEN_LIMIT);
  const validated = socialPostSchema.parse(input);

  return aiGenerateSocialPosts({
    title: validated.title,
    description: validated.description,
    department: validated.department ?? null,
    location: validated.location ?? null,
    applyUrl: validated.applyUrl ?? null,
    tone: validated.tone ?? null,
  });
}
