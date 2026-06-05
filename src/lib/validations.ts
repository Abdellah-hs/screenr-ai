import { z } from "zod/v4";

// ─── Campaign Validation ────────────────────────────────────────────────────

const campaignStatusValues = ["draft", "active", "paused", "closed", "archived"] as const;
const automationModeValues = ["fully_auto", "human_in_loop"] as const;
const interviewPersonaValues = ["neutral", "pressure", "collaborative", "socratic"] as const;

export const campaignFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().max(5000, "Description too long"),
  department: z.string().max(100).nullable(),
  positions: z.number().int().min(1).max(1000),
  status: z.enum(campaignStatusValues),
  deadline: z.string().nullable(),
  location: z.string().max(200).nullable(),
  automation_mode: z.enum(automationModeValues),
  screening_threshold: z.number().int().min(0).max(100),
  interview_persona: z.enum(interviewPersonaValues),
});

export const screeningCriterionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(200),
  weight: z.number().min(0).max(1),
  is_mandatory: z.boolean(),
});

export const slaTimerSchema = z.object({
  stage: z.string().min(1).max(50),
  time_limit_hours: z.number().int().min(1),
  alert_threshold_hours: z.number().int().min(1),
  escalation_threshold_hours: z.number().int().min(1),
});

export const rubricDimensionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  // Recruiter intent — the only weighting/gate inputs (issue #77). weight,
  // min_score and max_score are DERIVED server-side from these, so they are
  // accepted-but-ignored if the client sends them.
  importance: z.enum(["high", "medium", "low"]),
  is_mandatory: z.boolean(),
  weight: z.number().min(0).max(1).optional(),
  min_score: z.number().int().min(0).optional(),
  max_score: z.number().int().min(1).optional(),
  sort_order: z.number().int().min(0),
});

export const rubricSchema = z.object({
  stage: z.enum(["resume", "screening_q", "interview"]),
  dimensions: z.array(rubricDimensionSchema),
});

export const reviewerSchema = z.object({
  user_id: z.string().optional(),
  role: z.enum(["lead", "reviewer", "observer"]),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse and validate campaign form data. Throws on invalid input.
 */
export function parseCampaignFormData(formData: FormData) {
  const rawPositions = parseInt(formData.get("positions") as string);
  const rawThreshold = parseInt(formData.get("screening_threshold") as string);

  const data = campaignFormSchema.parse({
    title: formData.get("title") as string,
    description: (formData.get("description") as string) || "",
    department: (formData.get("department") as string) || null,
    positions: Number.isNaN(rawPositions) ? 1 : rawPositions,
    status: (formData.get("status") as string) || "draft",
    deadline: (formData.get("deadline") as string) || null,
    location: (formData.get("location") as string) || null,
    automation_mode: (formData.get("automation_mode") as string) || "human_in_loop",
    screening_threshold: Number.isNaN(rawThreshold) ? 70 : Math.min(100, Math.max(0, rawThreshold)),
    interview_persona: (formData.get("interview_persona") as string) || "neutral",
  });

  // Parse related JSON data with validation. Resume scoring criteria live in
  // the `resume` rubric (issue #65) — the standalone screening_criteria config
  // is retired, so only `rubrics_json` is parsed here.
  const rubrics = safeParseJsonArray(
    formData.get("rubrics_json") as string,
    z.array(rubricSchema)
  );

  const slaTimers = safeParseJsonArray(
    formData.get("sla_timers_json") as string,
    z.array(slaTimerSchema)
  );

  const reviewers = safeParseJsonArray(
    formData.get("reviewers_json") as string,
    z.array(reviewerSchema)
  );

  return { ...data, rubrics, slaTimers, reviewers };
}

function safeParseJsonArray<T>(json: string | null, schema: z.ZodType<T>): T {
  if (!json) return [] as unknown as T;
  try {
    const parsed = JSON.parse(json);
    return schema.parse(parsed);
  } catch {
    return [] as unknown as T;
  }
}

// ─── AI Generation Validation ───────────────────────────────────────────────

export const aiDescriptionSchema = z.string().min(10, "Description too short for AI generation").max(10000, "Description too long");

// ─── Application State Validation ───────────────────────────────────────────

// Must match the ApplicationState union in constants.ts exactly — the
// canonical candidate_stage_enum. A recruiter manual stage change is
// validated against this; whether a given transition is *legal* from the
// current state is enforced downstream by transitionApplication().
const applicationStateValues = [
  "new",
  "screening_review_pending",
  "screening_approved",
  "screening_sent",
  "screening_completed",
  "screening_scored",
  "interview_scheduling",
  "interview_scheduled",
  "interview_completed",
  "interview_scored",
  "reference_check",
  "manager_review",
  "final_interview_scheduling",
  "screening_expired",
  "interview_no_show",
  "processing_failed",
  "rejected",
  "hired",
  "withdrawn",
  "archived",
] as const;
export const applicationStateSchema = z.enum(applicationStateValues);

// A recruiter manual stage change must carry a written rationale — the ATS
// state machine treats unexplained overrides as forbidden (see CLAUDE.md).
export const stageChangeRationaleSchema = z
  .string()
  .trim()
  .min(1, "A reason is required for a manual stage change.");

// ─── Duplicate Review Validation ────────────────────────────────────────────

// HR resolving a flagged duplicate. A written rationale is mandatory —
// merging or keeping records separate is a reviewer decision that must be
// recorded on the flag.
export const resolveDuplicateSchema = z.object({
  flagId: z.string().uuid("Invalid flag ID"),
  decision: z.enum(["approved", "rejected"]),
  rationale: z
    .string()
    .trim()
    .min(1, "A reason is required to resolve a duplicate flag."),
});

// ─── UUID Validation ────────────────────────────────────────────────────────

export const uuidSchema = z.string().uuid("Invalid ID format");

// ─── Screening Questions ────────────────────────────────────────────────────

export const screeningQuestionSchema = z.object({
  id: z.string().optional(),
  prompt: z.string().min(10, "Question is too short").max(1000, "Question is too long"),
  is_required: z.boolean(),
});

export const screeningQuestionsArraySchema = z
  .array(screeningQuestionSchema)
  .min(1, "At least one question is required")
  .max(15, "Too many questions");

export const screeningAnswerSchema = z.object({
  question_id: uuidSchema,
  answer_text: z.string().min(1, "Answer cannot be empty").max(5000, "Answer is too long"),
});

export const screeningAnswerSubmissionSchema = z.object({
  token: z.string().min(10).max(2000),
  answers: z.array(screeningAnswerSchema).min(1, "No answers submitted").max(15),
});

// ─── Voice Screening (#83) ──────────────────────────────────────────────────

export const voiceTranscriptTurnSchema = z.object({
  role: z.enum(["agent", "candidate"]),
  text: z.string().min(1, "Empty transcript turn").max(10000, "Transcript turn is too long"),
  at: z.string().min(1, "Missing turn timestamp"),
});

export const voiceScreeningSubmissionSchema = z.object({
  token: z.string().min(10).max(2000),
  // A finished call always has at least one turn; an empty transcript is a
  // capture failure and is reported via the failure action, not submitted here.
  transcript: z
    .array(voiceTranscriptTurnSchema)
    .min(1, "No transcript was captured for this call.")
    .max(500, "Transcript is too long"),
});

// ─── HITL Screening Review ──────────────────────────────────────────────────

// Recruiter approve/reject decision on a screening_review_pending application.
// Rationale is mandatory because this is a recruiter-actor transition (per
// transitionApplication's contract) and overrides an AI suggestion.
export const hitlReviewDecisionSchema = z.object({
  applicationId: uuidSchema,
  decision: z.enum(["approve", "reject"]),
  rationale: z
    .string()
    .trim()
    .min(10, "Please give a short rationale (10+ characters)")
    .max(2000, "Rationale is too long"),
});
