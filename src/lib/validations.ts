import { z } from "zod/v4";
import { decodeStatusSelection } from "@/lib/rules/campaign-status";

// ─── Campaign Validation ────────────────────────────────────────────────────

const campaignStatusValues = ["draft", "active", "paused", "closed"] as const;
const automationModeValues = ["fully_auto", "human_in_loop"] as const;
const interviewPersonaValues = ["neutral", "pressure", "collaborative", "socratic"] as const;

export const campaignFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().max(5000, "Description too long"),
  department: z.string().max(100).nullable(),
  positions: z.number().int().min(1).max(1000),
  status: z.enum(campaignStatusValues),
  // Manual intake switch (decoded from the status dropdown alongside `status`).
  accepting_applications: z.boolean(),
  deadline: z.string().nullable(),
  // When true the deadline gates the public apply page; when false it's just
  // informational. Derived from a checkbox, so it's always a concrete boolean.
  deadline_enforced: z.boolean(),
  location: z.string().max(200).nullable(),
  automation_mode: z.enum(automationModeValues),
  screening_threshold: z.number().int().min(0).max(100),
  interview_persona: z.enum(interviewPersonaValues),
  // AI-interview availability config (PRD 3.5.6). Slots are generated from the
  // weekly availabilityRules; these are the campaign-level knobs.
  interview_slot_minutes: z.number().int().min(5).max(240).nullable(),
  interview_timezone: z.string().max(64).nullable(),
  interview_booking_horizon_days: z.number().int().min(1).max(90),
});

// Standalone status validator for the bulk status changer (a quick status set
// outside the full edit form). Campaign status is freely settable, so this just
// guards that the value is a real status.
export const campaignStatusSchema = z.enum(campaignStatusValues);

// The 5-option status dropdown value (real statuses + the `active_no_intake` UI
// token). Used by the inline per-campaign status changer, which can also flip
// the intake switch. Decoded via decodeStatusSelection into status + flag.
export const campaignStatusSelectionSchema = z.enum([
  "draft",
  "active",
  "active_no_intake",
  "paused",
  "closed",
]);

export const screeningCriterionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(200),
  weight: z.number().min(0).max(1),
  is_mandatory: z.boolean(),
});

// SLA stages are the non-terminal pipeline buckets (match SlaStage / SLA_STAGES
// in constants.ts). An older campaign may carry a legacy stage (e.g. the rubric
// value "screening_q") — those no longer validate and get cleaned up on re-save.
const slaStageValues = ["applied", "screening", "interview", "final_interview"] as const;

export const slaTimerSchema = z.object({
  stage: z.enum(slaStageValues),
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

// One weekly AI-interview availability rule. weekday 0=Sunday..6=Saturday;
// times are minutes-from-midnight in the campaign's interview_timezone.
export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.end_minute > r.start_minute, {
    message: "End time must be after start time",
    path: ["end_minute"],
  });

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse and validate campaign form data. Throws on invalid input.
 */
export function parseCampaignFormData(formData: FormData) {
  const rawPositions = parseInt(formData.get("positions") as string);
  const rawThreshold = parseInt(formData.get("screening_threshold") as string);
  const rawSlotMinutes = parseInt(formData.get("interview_slot_minutes") as string);
  const rawHorizon = parseInt(formData.get("interview_booking_horizon_days") as string);

  const data = campaignFormSchema.parse({
    title: formData.get("title") as string,
    description: (formData.get("description") as string) || "",
    department: (formData.get("department") as string) || null,
    positions: Number.isNaN(rawPositions) ? 1 : rawPositions,
    // The status dropdown carries the two "Active —" options; decode into the
    // real lifecycle status + the manual intake switch.
    ...decodeStatusSelection((formData.get("status") as string) || "draft"),
    deadline: (formData.get("deadline") as string) || null,
    // Radio group: the "true"/"false" option value, defaulting to false
    // (informational) when absent.
    deadline_enforced: formData.get("deadline_enforced") === "true",
    location: (formData.get("location") as string) || null,
    automation_mode: (formData.get("automation_mode") as string) || "human_in_loop",
    screening_threshold: Number.isNaN(rawThreshold) ? 70 : Math.min(100, Math.max(0, rawThreshold)),
    interview_persona: (formData.get("interview_persona") as string) || "neutral",
    interview_slot_minutes: Number.isNaN(rawSlotMinutes) ? null : rawSlotMinutes,
    interview_timezone: (formData.get("interview_timezone") as string)?.trim() || null,
    interview_booking_horizon_days: Number.isNaN(rawHorizon) ? 14 : rawHorizon,
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

  const availabilityRules = safeParseJsonArray(
    formData.get("availability_rules_json") as string,
    z.array(availabilityRuleSchema)
  );

  return { ...data, rubrics, slaTimers, reviewers, availabilityRules };
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

// Inputs for the AI job-description assist. All grounding fields are optional
// except the title; "improve" additionally requires a non-empty current draft.
// These are generation-only inputs — none of them are persisted on the campaign.
export const generateDescriptionSchema = z
  .object({
    mode: z.enum(["generate", "improve"]),
    title: z.string().trim().min(1, "A role title is needed to generate a description").max(200),
    department: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    seniority: z.string().trim().max(100).optional(),
    employmentType: z.string().trim().max(100).optional(),
    skills: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    companyContext: z.string().trim().max(2000).optional(),
    currentDraft: z.string().trim().max(10000).optional(),
  })
  .refine(
    (v) => v.mode !== "improve" || (v.currentDraft?.length ?? 0) > 0,
    { message: "There's no draft to improve yet.", path: ["currentDraft"] },
  );

export type GenerateDescriptionInput = z.infer<typeof generateDescriptionSchema>;

// Inputs for the AI social-post generator. Advisory generation only — produces
// copy the recruiter edits and posts manually; nothing here is persisted.
export const SOCIAL_POST_TONES = ["professional", "friendly", "enthusiastic", "concise"] as const;

export const socialPostSchema = z.object({
  title: z.string().trim().min(1, "A role title is needed to generate posts").max(200),
  description: z.string().trim().min(1, "A description is needed to generate posts").max(10000),
  department: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  applyUrl: z.string().trim().max(500).optional(),
  tone: z.enum(SOCIAL_POST_TONES).optional(),
});

export type SocialPostGenerationInput = z.infer<typeof socialPostSchema>;

// The (possibly edited) copy a recruiter publishes to a connected channel.
// LinkedIn's member-post commentary caps at 3000 characters.
export const socialPublishSchema = z.object({
  text: z.string().trim().min(1, "There's nothing to publish").max(3000, "Post exceeds LinkedIn's 3000-character limit"),
});

export type SocialPublishInput = z.infer<typeof socialPublishSchema>;

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
  "interview_invited",
  "interview_scheduling",
  "interview_scheduled",
  "interview_completed",
  "interview_scored",
  "reference_check",
  "manager_review",
  "final_interview_scheduling",
  "screening_expired",
  "interview_no_show",
  "interview_expired",
  "processing_failed",
  "rejected",
  "hired",
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

// A batch of campaign ids for bulk row actions (remove / set status). Capped to
// keep a single request bounded.
export const campaignIdsSchema = z
  .array(uuidSchema)
  .min(1, "Select at least one campaign")
  .max(100, "Too many campaigns selected");

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

// Shape of one agent-reported transcript turn (the agent worker posts these to
// the agent API route — since the LiveKit migration the candidate's browser
// never submits transcript content).
export const voiceTranscriptTurnSchema = z.object({
  role: z.enum(["agent", "candidate"]),
  text: z.string().min(1, "Empty transcript turn").max(10000, "Transcript turn is too long"),
  at: z.string().min(1, "Missing turn timestamp"),
});

// ─── Interview Scheduling (booking) ─────────────────────────────────────────

// Candidate picks a slot on the token-gated /schedule page. The chosen slot is
// authoritatively re-validated server-side against the regenerated slot list,
// so this schema only checks basic shape.
export const bookInterviewSlotSchema = z.object({
  token: z.string().min(10).max(2000),
  start_iso: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid slot time"),
});

// ─── Public Apply Form ──────────────────────────────────────────────────────

/** Drop a leading protocol/www so prefix-style inputs normalize predictably. */
function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

// Identity the candidate types on the public apply page. Names are trimmed;
// the email is normalized to lowercase before the format check so candidate
// dedup (which matches on email) stays case-insensitive. The profile links are
// optional prefix inputs (the UI shows "linkedin.com/" / "https://"), so users
// paste anything from a bare handle to a full URL — both normalize to a full
// https URL, and blank normalizes to null.
export const applyApplicantSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, "Please enter your first name")
    .max(100, "First name is too long"),
  last_name: z
    .string()
    .trim()
    .min(1, "Please enter your last name")
    .max(100, "Last name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Email address is too long")
    .pipe(z.email("Please enter a valid email address")),
  linkedin: z
    .string()
    .trim()
    .max(200, "LinkedIn profile is too long")
    .default("")
    .transform((v): string | null => {
      const path = stripProtocol(v).replace(/^linkedin\.com\//i, "").replace(/^\/+/, "");
      return path ? `https://www.linkedin.com/${path}` : null;
    }),
  website: z
    .string()
    .trim()
    .max(200, "Website address is too long")
    .default("")
    .refine(
      (v) => v === "" || /^\S+\.\S+$/.test(stripProtocol(v)),
      "Please enter a valid website address",
    )
    .transform((v): string | null => {
      const rest = stripProtocol(v);
      return rest ? `https://${rest}` : null;
    }),
});

// ─── Interview Proctoring ───────────────────────────────────────────────────

// Raw browser observations reported by the candidate's interview client. This is
// untrusted input from a candidate-facing (token-only) endpoint, so it is bounded
// hard: a closed set of event types, a parseable timestamp, and a duration that
// can't exceed the interview itself. Severity is deliberately NOT accepted here —
// the rule layer (`summarizeProctoring`) decides it server-side.

const proctoringEventTypeValues = ["tab_blur", "camera_off"] as const;

/** No single incident can outlast the 20-minute call cap; allow an hour of slack. */
const MAX_INCIDENT_DURATION_MS = 60 * 60 * 1000;

/** A misbehaving or malicious client can't flood the row with events. */
const MAX_PROCTORING_EVENTS = 200;

export const proctoringEventSchema = z.object({
  type: z.enum(proctoringEventTypeValues),
  at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp"),
  duration_ms: z.number().int().min(0).max(MAX_INCIDENT_DURATION_MS),
});

export const proctoringEventsSchema = z.array(proctoringEventSchema).max(MAX_PROCTORING_EVENTS);

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
