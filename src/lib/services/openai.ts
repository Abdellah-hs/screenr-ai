import OpenAI from "openai";
import type { ScreeningCriterion, EvaluationRubric } from "@/lib/constants";
import type { ResumeScoreResult } from "@/lib/rules/resume-scoring";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function assertApiKeyConfigured(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

export type ResumeExperience = {
  company: string;
  title: string;
  duration: string;
  description: string;
};

export type ResumeEducation = {
  institution: string;
  degree: string;
  graduation_year: string;
};

export type ParsedResumeData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_url: string;
  portfolio_url: string;
  skills: string[];
  experience: ResumeExperience[];
  education: ResumeEducation[];
};

/**
 * Extracts structured candidate data from raw PDF text using OpenAI
 */
export async function extractResumeData(pdfText: string): Promise<ParsedResumeData> {
  assertApiKeyConfigured();

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are an expert ATS (Applicant Tracking System) parser. Extract the candidate's core information from the provided resume text. Return a clean, precise JSON response.",
      },
      {
        role: "user",
        content: `Extract information from this resume:\n\n${pdfText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "resume_extraction",
        schema: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            location: { type: "string" },
            linkedin_url: { type: "string" },
            portfolio_url: { type: "string" },
            skills: { type: "array", items: { type: "string" } },
            experience: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  duration: { type: "string" },
                  description: { type: "string" }
                },
                required: ["company", "title", "duration", "description"],
                additionalProperties: false
              }
            },
            education: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  institution: { type: "string" },
                  degree: { type: "string" },
                  graduation_year: { type: "string" }
                },
                required: ["institution", "degree", "graduation_year"],
                additionalProperties: false
              }
            }
          },
          required: [
            "first_name",
            "last_name",
            "email",
            "phone",
            "location",
            "linkedin_url",
            "portfolio_url",
            "skills",
            "experience",
            "education"
          ],
          additionalProperties: false
        },
        strict: true
      }
    },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Failed to parse resume with OpenAI");

  return JSON.parse(content) as ParsedResumeData;
}

/**
 * AI-generates screening criteria from the job description.
 */
export async function generateScreeningCriteria(
  description: string
): Promise<ScreeningCriterion[]> {
  assertApiKeyConfigured();

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
        content: `Generate screening criteria for this role:\n\n${description}`,
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
  assertApiKeyConfigured();

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
        content: `Generate rubric dimensions for this role:\n\n${description}`,
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

/**
 * AI-scores a parsed resume against a campaign's screening criteria.
 * Returns an overall score (0-100), tier, rationale, and per-criterion factors.
 */
export async function scoreResumeAgainstCriteria(
  parsedResume: Record<string, unknown>,
  screeningCriteria: ScreeningCriterion[],
  jobDescription: string
): Promise<ResumeScoreResult> {
  assertApiKeyConfigured();

  const criteriaList = screeningCriteria
    .map((c) => `- ${c.label} (weight: ${c.weight}, mandatory: ${c.is_mandatory})`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert ATS (Applicant Tracking System) resume screener. You evaluate resumes against specific screening criteria for a job posting.

Score the resume against EACH criterion on a 0-100 scale, then compute a weighted overall score.

Classify the candidate into a tier based on the overall score:
- "strong": 75-100 (excellent fit)
- "moderate": 50-74 (potential fit, worth reviewing)
- "weak": 25-49 (poor fit on most criteria)
- "no_match": 0-24 (does not meet basic requirements)

IMPORTANT: If a candidate fails ANY mandatory criterion (scores below 30), the maximum tier is "weak" regardless of overall score.

Return JSON in this exact format:
{
  "overall_score": number,
  "tier": "strong" | "moderate" | "weak" | "no_match",
  "rationale": "2-4 sentence summary explaining the score and tier classification",
  "factors": [
    { "name": "criterion label", "weight": number, "score": number }
  ]
}

Rules:
- overall_score must equal the weighted sum of factor scores (rounded to nearest integer)
- Each factor score is 0-100
- factors array must have one entry per screening criterion, in the same order
- rationale must reference specific resume details (skills, experience, education)
- Be objective and fair — score based on evidence in the resume, not assumptions`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}

## Screening Criteria
${criteriaList}

## Parsed Resume Data
${JSON.stringify(parsedResume, null, 2)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for resume scoring");
  }

  const parsed = JSON.parse(content) as ResumeScoreResult;

  const overall = Math.max(0, Math.min(100, Math.round(parsed.overall_score)));
  const validTiers = ["strong", "moderate", "weak", "no_match"] as const;
  const tier = validTiers.includes(parsed.tier as typeof validTiers[number])
    ? parsed.tier
    : overall >= 75 ? "strong" : overall >= 50 ? "moderate" : overall >= 25 ? "weak" : "no_match";

  return {
    overall_score: overall,
    tier: tier as ResumeScoreResult["tier"],
    rationale: parsed.rationale || "No rationale provided.",
    factors: (parsed.factors || []).map((f) => ({
      name: f.name,
      weight: f.weight,
      score: Math.max(0, Math.min(100, Math.round(f.score))),
    })),
  };
}
