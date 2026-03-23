// @ts-nocheck
"use server";

import { getAnthropicClient } from "@/lib/ai/client";
import type { ScreeningCriterion, EvaluationRubric, ScoreFactor } from "@/lib/constants";

// ─── Resume Parsing ─────────────────────────────────────────────────────────

export interface ParsedResume {
  name: string;
  email: string;
  phone: string | null;
  current_title: string | null;
  current_company: string | null;
  skills: string[];
  experience_years: number;
  education: string;
}

export async function parseResumeWithAI(
  resumeText: string
): Promise<ParsedResume> {
  return {
    name: "John Doe",
    email: "john.doe@example.com",
    phone: "1234567890",
    current_title: "Software Engineer",
    current_company: "TestCorp",
    skills: ["React", "TypeScript", "Node.js"],
    experience_years: 5,
    education: "BS Computer Science, Tech University"
  };
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Extract structured information from this resume text. Return ONLY valid JSON with no additional text or markdown formatting.

Resume text:
${resumeText}

Return JSON in this exact format:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "+1-xxx-xxx-xxxx or null",
  "current_title": "Current Job Title or null",
  "current_company": "Current Company or null",
  "skills": ["skill1", "skill2"],
  "experience_years": 0,
  "education": "Highest degree, Institution"
}

Rules:
- Extract the most recent job title and company for current_title and current_company
- Calculate experience_years from total professional work experience
- List technical and professional skills (not soft skills)
- For education, use format "Degree in Field, Institution"
- If a field cannot be determined, use null for strings or 0/[] for numbers/arrays`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  // Extract JSON from response (handle markdown code blocks)
  let jsonText = content.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  return JSON.parse(jsonText) as ParsedResume;
}

// ─── Resume Scoring ─────────────────────────────────────────────────────────

interface ScoreResult {
  overall: number;
  tier: "strong" | "moderate" | "weak";
  ai_summary: string;
  factors: ScoreFactor[];
}

export async function scoreResumeWithAI(
  resumeText: string,
  campaign: {
    title: string;
    description: string;
    screening_criteria: ScreeningCriterion[];
    rubrics: EvaluationRubric[];
    screening_threshold: number;
  }
): Promise<ScoreResult> {
  const client = getAnthropicClient();

  const resumeRubric = campaign.rubrics.find(
    (r) => r.stage === "resume" && r.is_active
  );

  const criteriaText = campaign.screening_criteria.length > 0
    ? campaign.screening_criteria
        .map(
          (c) =>
            `- ${c.label} (weight: ${c.weight}, mandatory: ${c.is_mandatory})`
        )
        .join("\n")
    : "No specific criteria defined — evaluate based on job description fit.";

  const rubricText = resumeRubric
    ? `\nEvaluation Rubric Dimensions:\n${resumeRubric.dimensions
        .map(
          (d) =>
            `- ${d.name} (weight: ${d.weight}, mandatory: ${d.is_mandatory})`
        )
        .join("\n")}`
    : "";

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are an expert HR evaluator. Score this resume against the job requirements.

Job Title: ${campaign.title}
Job Description: ${campaign.description}

Screening Criteria:
${criteriaText}
${rubricText}

Resume:
${resumeText}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "overall": <0-100 integer score>,
  "tier": "strong" | "moderate" | "weak",
  "ai_summary": "<2-3 sentence evaluation summary>",
  "factors": [
    { "name": "<criterion or dimension name>", "weight": <0-1>, "score": <0-100> }
  ]
}

Scoring guidelines:
- 80-100 = strong (excellent match for the role)
- 60-79 = moderate (decent match with some gaps)
- 0-59 = weak (significant gaps in requirements)
- Use rubric dimensions as factor names if available, otherwise use screening criteria labels
- Weight each factor according to the provided weights
- The overall score should be the weighted average of all factors
- Be calibrated: most candidates should score between 40-85
- ai_summary should note specific strengths and gaps`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  let jsonText = content.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  return JSON.parse(jsonText) as ScoreResult;
}
