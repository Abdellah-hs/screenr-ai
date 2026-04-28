"use server";

import type { ScreeningCriterion, EvaluationRubric } from "@/lib/constants";
import { aiDescriptionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import {
  generateScreeningCriteria as aiGenerateScreeningCriteria,
  generateRubricDimensions as aiGenerateRubricDimensions,
} from "@/lib/services/openai";

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
