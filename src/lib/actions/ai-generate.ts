"use server";

import OpenAI from "openai";
import type { ScreeningCriterion, EvaluationRubric } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { aiDescriptionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * AI-generates screening criteria from the job description.
 */
export async function generateScreeningCriteria(
  description: string
): Promise<ScreeningCriterion[]> {
  // Auth guard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Rate limit: 10 AI generations per 5 minutes per user
  checkRateLimit(user.id, { name: "ai-generate", maxRequests: 10, windowMs: 5 * 60 * 1000 });

  // Validate input
  const validatedDescription = aiDescriptionSchema.parse(description);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert HR hiring consultant. Given a job description, generate 4-7 screening criteria that a hiring manager would use to evaluate resumes.

Return JSON in this exact format:
{
  "criteria": [
    { "label": "string", "weight": number, "is_mandatory": boolean }
  ]
}

Rules:
- Weights must sum to 1.0
- Each weight is between 0.05 and 0.35
- Mark 1-3 criteria as mandatory (the most critical ones)
- Labels should be specific to the role, not generic
- Keep labels concise (2-5 words)`,
      },
      {
        role: "user",
        content: `Generate screening criteria for this role:\n\n${validatedDescription}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  const parsed = JSON.parse(content) as {
    criteria: { label: string; weight: number; is_mandatory: boolean }[];
  };

  if (!parsed.criteria?.length) {
    throw new Error("OpenAI returned no criteria");
  }

  return parsed.criteria.map((c) => ({
    id: generateId("sc"),
    label: c.label,
    weight: Math.round(c.weight * 100) / 100,
    is_mandatory: c.is_mandatory,
  }));
}

/**
 * AI-generates evaluation rubric dimensions for each pipeline stage.
 */
export async function generateRubricDimensions(
  description: string,
  campaignId: string
): Promise<EvaluationRubric[]> {
  // Auth guard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Rate limit: 10 AI generations per 5 minutes per user
  checkRateLimit(user.id, { name: "ai-generate", maxRequests: 10, windowMs: 5 * 60 * 1000 });

  // Validate input
  const validatedDescription = aiDescriptionSchema.parse(description);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert HR hiring consultant. Given a job description, generate evaluation rubric dimensions for three pipeline stages: resume review, screening questions, and interview.

Return JSON in this exact format:
{
  "resume": [
    { "name": "string", "weight": number, "is_mandatory": boolean }
  ],
  "screening_q": [
    { "name": "string", "weight": number, "is_mandatory": boolean }
  ],
  "interview": [
    { "name": "string", "weight": number, "is_mandatory": boolean }
  ]
}

Rules:
- Each stage should have 4-6 dimensions
- Weights within each stage must sum to 1.0
- Each weight is between 0.05 and 0.35
- Mark 1-3 dimensions per stage as mandatory
- Dimension names should be specific to the role
- Keep names concise (2-5 words)
- Resume dimensions focus on qualifications on paper
- Screening dimensions focus on written answer quality
- Interview dimensions focus on live conversation performance`,
      },
      {
        role: "user",
        content: `Generate rubric dimensions for this role:\n\n${validatedDescription}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  const parsed = JSON.parse(content) as Record<
    string,
    { name: string; weight: number; is_mandatory: boolean }[]
  >;

  const now = new Date().toISOString();
  const stages = ["resume", "screening_q", "interview"] as const;

  for (const stage of stages) {
    if (!parsed[stage]?.length) {
      throw new Error(`OpenAI returned no dimensions for ${stage} stage`);
    }
  }

  return stages.map((stage) => ({
    id: generateId("rub"),
    campaign_id: campaignId,
    stage,
    version: 1,
    is_active: true,
    dimensions: parsed[stage].map((d, i) => ({
      id: generateId("dim"),
      name: d.name,
      weight: Math.round(d.weight * 100) / 100,
      is_mandatory: d.is_mandatory,
      min_score: 0,
      max_score: 100,
      sort_order: i,
    })),
    created_at: now,
    archived_at: null,
  }));
}
