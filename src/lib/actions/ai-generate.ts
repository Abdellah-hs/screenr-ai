"use server";

import type { ScreeningCriterion, EvaluationRubric, RubricDimension } from "@/lib/constants";

// ─── Mock AI Generation ──────────────────────────────────────────────────────
// Structured for future Claude API integration (claude-opus-4-5).
// When ANTHROPIC_API_KEY is configured, replace the mock functions below
// with real API calls via lib/ai/ helpers.
// ──────────────────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * AI-suggests screening criteria from the job description.
 * Manager will review, edit, and accept these suggestions.
 */
export async function generateScreeningCriteria(
  description: string
): Promise<ScreeningCriterion[]> {
  // TODO: Replace with Claude API call when ANTHROPIC_API_KEY is available
  // const response = await claude.messages.create({
  //   model: "claude-opus-4-5-20250624",
  //   system: "You are an HR expert...",
  //   messages: [{ role: "user", content: `Generate screening criteria for: ${description}` }],
  // });

  await simulateLatency();

  const desc = description.toLowerCase();
  const criteria: ScreeningCriterion[] = [];

  // Always include experience
  criteria.push({
    id: generateId("sc"),
    label: "Relevant work experience",
    weight: 0.25,
    is_mandatory: true,
  });

  // Education
  criteria.push({
    id: generateId("sc"),
    label: "Education & qualifications",
    weight: 0.15,
    is_mandatory: false,
  });

  // Technical skills based on description keywords
  if (hasAny(desc, ["engineer", "developer", "programming", "software", "code", "technical"])) {
    criteria.push({
      id: generateId("sc"),
      label: "Technical skills proficiency",
      weight: 0.25,
      is_mandatory: true,
    });
  }

  if (hasAny(desc, ["ai", "machine learning", "ml", "data science", "deep learning", "nlp"])) {
    criteria.push({
      id: generateId("sc"),
      label: "AI / Machine Learning expertise",
      weight: 0.2,
      is_mandatory: true,
    });
  }

  if (hasAny(desc, ["lead", "senior", "manager", "head", "director", "team"])) {
    criteria.push({
      id: generateId("sc"),
      label: "Leadership & team management",
      weight: 0.15,
      is_mandatory: false,
    });
  }

  if (hasAny(desc, ["design", "ux", "ui", "figma", "creative"])) {
    criteria.push({
      id: generateId("sc"),
      label: "Design portfolio & UX sensibility",
      weight: 0.2,
      is_mandatory: true,
    });
  }

  if (hasAny(desc, ["sales", "revenue", "business development", "client", "account"])) {
    criteria.push({
      id: generateId("sc"),
      label: "Sales track record & client management",
      weight: 0.2,
      is_mandatory: true,
    });
  }

  // Communication is always relevant
  criteria.push({
    id: generateId("sc"),
    label: "Communication skills",
    weight: 0.1,
    is_mandatory: false,
  });

  // Cultural fit
  criteria.push({
    id: generateId("sc"),
    label: "Cultural fit & values alignment",
    weight: 0.1,
    is_mandatory: false,
  });

  // Normalize weights to sum to 1.0
  return normalizeWeights(criteria);
}

/**
 * AI-generates evaluation rubric dimensions for each pipeline stage.
 * Manager will review and customize per stage.
 */
export async function generateRubricDimensions(
  description: string,
  campaignId: string
): Promise<EvaluationRubric[]> {
  await simulateLatency();

  const desc = description.toLowerCase();
  const now = new Date().toISOString();

  const isTechnical = hasAny(desc, [
    "engineer", "developer", "software", "technical", "code",
    "ai", "ml", "data", "infrastructure", "devops", "backend", "frontend",
  ]);

  // Resume stage dimensions
  const resumeDimensions: RubricDimension[] = [
    makeDimension("Relevant experience", 0.3, true, 0),
    makeDimension("Education match", 0.15, false, 1),
    makeDimension("Skills alignment", 0.25, true, 2),
    makeDimension("Career progression", 0.15, false, 3),
    makeDimension("Overall resume quality", 0.15, false, 4),
  ];

  // Screening questions stage dimensions
  const screeningDimensions: RubricDimension[] = [
    makeDimension("Domain knowledge depth", 0.3, true, 0),
    makeDimension("Communication clarity", 0.2, false, 1),
    makeDimension("Problem-solving approach", 0.25, true, 2),
    makeDimension("Motivation & enthusiasm", 0.15, false, 3),
    makeDimension("Response completeness", 0.1, false, 4),
  ];

  // Interview stage dimensions — vary by role type
  const interviewDimensions: RubricDimension[] = isTechnical
    ? [
        makeDimension("Technical depth", 0.25, true, 0),
        makeDimension("System design thinking", 0.2, true, 1),
        makeDimension("Problem-solving under pressure", 0.2, true, 2),
        makeDimension("Code quality & best practices", 0.15, false, 3),
        makeDimension("Communication & collaboration", 0.1, false, 4),
        makeDimension("Cultural fit", 0.1, false, 5),
      ]
    : [
        makeDimension("Role-specific expertise", 0.25, true, 0),
        makeDimension("Strategic thinking", 0.2, true, 1),
        makeDimension("Communication & presentation", 0.2, false, 2),
        makeDimension("Leadership potential", 0.15, false, 3),
        makeDimension("Problem-solving ability", 0.1, true, 4),
        makeDimension("Cultural fit", 0.1, false, 5),
      ];

  return [
    {
      id: generateId("rub"),
      campaign_id: campaignId,
      stage: "resume",
      version: 1,
      is_active: true,
      dimensions: resumeDimensions,
      created_at: now,
      archived_at: null,
    },
    {
      id: generateId("rub"),
      campaign_id: campaignId,
      stage: "screening_q",
      version: 1,
      is_active: true,
      dimensions: screeningDimensions,
      created_at: now,
      archived_at: null,
    },
    {
      id: generateId("rub"),
      campaign_id: campaignId,
      stage: "interview",
      version: 1,
      is_active: true,
      dimensions: interviewDimensions,
      created_at: now,
      archived_at: null,
    },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function makeDimension(
  name: string,
  weight: number,
  is_mandatory: boolean,
  sort_order: number
): RubricDimension {
  return {
    id: generateId("dim"),
    name,
    weight,
    is_mandatory,
    min_score: 0,
    max_score: 100,
    sort_order,
  };
}

function normalizeWeights(criteria: ScreeningCriterion[]): ScreeningCriterion[] {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total === 0) return criteria;
  return criteria.map((c) => ({
    ...c,
    weight: Math.round((c.weight / total) * 100) / 100,
  }));
}

function simulateLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 800));
}
