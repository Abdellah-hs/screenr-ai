// ─── Campaign Types ──────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "active" | "paused" | "closed" | "archived";
export type AutomationMode = "fully_auto" | "human_in_loop";
export type InterviewPersona = "neutral" | "pressure" | "collaborative" | "socratic";
export type ReviewerRole = "lead" | "reviewer" | "observer";
export type PipelineStage = "resume" | "screening_q" | "interview";

export interface ScreeningCriterion {
  id: string;
  label: string;
  weight: number;
  is_mandatory: boolean;
}

/**
 * How much a rubric dimension counts toward the weighted stage score. The
 * recruiter picks one of these three levels; the system derives the numeric
 * `weight` from it (see `deriveDimensionFields`). Recruiters never set raw
 * weights — see the two-decision rubric model (issue #77).
 */
export type DimensionImportance = "high" | "medium" | "low";

export interface RubricDimension {
  id: string;
  name: string;
  /** Recruiter intent. Source of truth for the derived `weight`. */
  importance: DimensionImportance;
  /** "Must Have" — failing this dimension is a knockout (drives the gate). */
  is_mandatory: boolean;
  /** Derived from `importance`, normalized so a rubric's weights sum to ~1. */
  weight: number;
  /** Derived: knockout fail line — 30 when mandatory, else 0. */
  min_score: number;
  /** Derived: always 100. */
  max_score: number;
  sort_order: number;
}

/** Importance → relative points, normalized into `weight` across a rubric. */
export const IMPORTANCE_POINTS: Record<DimensionImportance, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Internal knockout fail line applied to every "Must Have" dimension. */
export const MANDATORY_FAIL_LINE = 30;

export interface EvaluationRubric {
  id: string;
  campaign_id: string;
  stage: PipelineStage;
  version: number;
  is_active: boolean;
  dimensions: RubricDimension[];
  created_at: string;
  archived_at: string | null;
}

export interface CampaignReviewer {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: ReviewerRole;
  assigned_at: string;
}

export interface SlaTimer {
  stage: PipelineStage | "applied" | "final_interview" | "hired";
  time_limit_hours: number;
  alert_threshold_hours: number;
  escalation_threshold_hours: number;
}

// One weekly AI-interview availability rule (PRD 3.5.6). `weekday` is
// 0=Sunday..6=Saturday (matching JS Date.getDay()); times are minutes from
// midnight in the campaign's `interview_timezone`.
export interface InterviewAvailabilityRule {
  weekday: number;
  start_minute: number;
  end_minute: number;
}

// Weekday labels indexed by `InterviewAvailabilityRule.weekday`.
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface PipelineStageCount {
  name: string;
  key: string;
  count: number;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  department: string | null;
  positions: number;
  status: CampaignStatus;
  deadline: string | null;
  location: string | null;
  timezone: string | null;
  application_email: string | null;
  automation_mode: AutomationMode;
  screening_threshold: number;
  interview_persona: InterviewPersona;
  rubrics: EvaluationRubric[];
  reviewers: CampaignReviewer[];
  sla_timers: SlaTimer[];
  // AI-interview availability config (PRD 3.5.6).
  interview_slot_minutes: number | null;
  interview_timezone: string | null;
  interview_booking_horizon_days: number;
  interview_availability_rules: InterviewAvailabilityRule[];
  pipeline: PipelineStageCount[];
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ─── Status Config ───────────────────────────────────────────────────────────

export const CAMPAIGN_STATUSES: { value: CampaignStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];

export const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  closed: "bg-red-100 text-red-700",
  archived: "bg-slate-100 text-slate-500",
};

/** Valid status transitions — key can move to any value in the array */
export const STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: ["archived"],
  archived: [],
};

export const AUTOMATION_MODES: { value: AutomationMode; label: string; description: string }[] = [
  { value: "fully_auto", label: "Fully Automatic", description: "AI handles the entire pipeline autonomously" },
  { value: "human_in_loop", label: "Human-in-the-Loop", description: "Manager reviews and approves at each stage" },
];

export const INTERVIEW_PERSONAS: { value: InterviewPersona; label: string; description: string }[] = [
  { value: "neutral", label: "Neutral", description: "Balanced and professional tone" },
  { value: "pressure", label: "Pressure", description: "Tests composure under challenging questions" },
  { value: "collaborative", label: "Collaborative", description: "Warm, conversational problem-solving style" },
  { value: "socratic", label: "Socratic", description: "Guided questioning to reveal depth of knowledge" },
];

export const PIPELINE_STAGES: { name: string; key: string }[] = [
  { name: "New", key: "applied" },
  { name: "Screening", key: "screening" },
  { name: "Interview", key: "interview" },
  { name: "Final Interview", key: "final_interview" },
  { name: "Hired", key: "hired" },
];

// ─── Candidate Types ────────────────────────────────────────────────────────

export type CandidateStage = "applied" | "screening" | "interview" | "final_interview" | "hired" | "rejected";
export type ScreeningTier = "strong" | "moderate" | "weak";

export interface ScoreFactor {
  name: string;
  weight: number;
  score: number;
}

export interface CandidateScore {
  stage: "resume" | "screening" | "interview";
  overall: number;
  tier?: ScreeningTier;
  ai_summary: string;
  factors: ScoreFactor[];
  scored_at: string;
  /**
   * Version of the stage's evaluation_rubric active when this score was
   * produced. Null for scores written before rubric versioning was tracked.
   */
  rubric_version: number | null;
  /**
   * Version of the stage's evaluation_rubric currently active on the
   * campaign. Null when no active rubric exists for that stage. The UI
   * shows a mismatch badge when this differs from `rubric_version`.
   */
  current_rubric_version: number | null;
}

export interface Candidate {
  id: string;
  campaign_id: string;
  name: string;
  email: string;
  phone: string | null;
  current_title: string | null;
  current_company: string | null;
  stage: CandidateStage;
  // Derived from raw application.status === "screening_review_pending".
  // Surfaced as a boolean (not a stage value) because HITL-pending is a
  // workflow flag — the HITL review panel resolves it, not the recruiter's
  // manual stage changer.
  awaiting_human_review: boolean;
  scores: CandidateScore[];
  resume: {
    skills: string[];
    experience_years: number;
    education: string;
  };
  applied_at: string;
  updated_at: string;
}

// ─── Candidate Config ───────────────────────────────────────────────────────

export const CANDIDATE_STAGES: { name: string; key: CandidateStage }[] = [
  { name: "New", key: "applied" },
  { name: "Screening", key: "screening" },
  { name: "Interview", key: "interview" },
  { name: "Final Interview", key: "final_interview" },
  { name: "Hired", key: "hired" },
];

export const STAGE_COLORS: Record<CandidateStage, string> = {
  applied: "bg-gray-100 text-gray-700",
  screening: "bg-blue-100 text-blue-700",
  interview: "bg-purple-100 text-purple-700",
  final_interview: "bg-amber-100 text-amber-700",
  hired: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export const TIER_COLORS: Record<ScreeningTier, string> = {
  strong: "bg-green-100 text-green-700",
  moderate: "bg-amber-100 text-amber-700",
  weak: "bg-red-100 text-red-700",
};

export const TIER_LABELS: Record<ScreeningTier, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

export const STAGE_ORDER: CandidateStage[] = ["applied", "screening", "interview", "final_interview", "hired"];

// ─── Application State Machine ──────────────────────────────────────────────
// The DB enum `candidate_stage_enum` is the source of truth for an
// application's pipeline state. All transitions MUST go through
// `transitionApplication()` (see src/lib/data/transitions.ts) and are
// validated against the map below. See CLAUDE.md → ATS State Machine Rules.

export type ApplicationState =
  // Entry
  | "new"
  // Canonical screening stages
  | "screening_review_pending"
  | "screening_approved"
  | "screening_sent"
  | "screening_completed"
  | "screening_scored"
  // Canonical interview stages
  | "interview_scheduling"
  | "interview_scheduled"
  | "interview_completed"
  | "interview_scored"
  // Post-interview
  | "reference_check"
  | "manager_review"
  | "final_interview_scheduling"
  // Failure states — explicit, never silent
  | "screening_expired"
  | "interview_no_show"
  | "processing_failed"
  // Terminal
  | "rejected"
  | "hired"
  | "archived";

/**
 * Legal transitions per state. The key is the from_state; the array lists
 * every legal to_state. Empty array = terminal state.
 *
 * Canonical-only since issue #28 — the legacy values `screening`,
 * `screening_q`, and `interview` were migrated to canonical names and
 * dropped from `candidate_stage_enum`.
 */
export const APPLICATION_STATE_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  // Entry — `new` can go to HITL review or straight to approved (auto mode).
  new: [
    "screening_review_pending",
    "screening_approved",
    "processing_failed",
    "rejected",
  ],

  // Canonical screening track
  screening_review_pending: ["screening_approved", "rejected"],
  screening_approved: ["screening_sent", "rejected"],
  screening_sent: ["screening_completed", "screening_expired", "rejected"],
  screening_completed: ["screening_scored", "processing_failed", "rejected"],
  screening_scored: ["interview_scheduling", "rejected"],

  // Canonical interview track
  interview_scheduling: ["interview_scheduled", "rejected"],
  interview_scheduled: ["interview_completed", "interview_no_show", "rejected"],
  interview_completed: ["interview_scored", "processing_failed", "rejected"],
  interview_scored: ["reference_check", "manager_review", "rejected"],

  // Post-interview
  reference_check: ["manager_review", "rejected"],
  manager_review: ["final_interview_scheduling", "hired", "rejected"],
  final_interview_scheduling: ["hired", "rejected"],

  // Failure states — observable dead-ends, archived is the only exit.
  screening_expired: ["archived"],
  interview_no_show: ["archived"],
  processing_failed: ["archived"],

  // Terminal — only `archived` is reachable from them (for housekeeping).
  rejected: ["archived"],
  hired: ["archived"],
  archived: [],
};

export type TransitionActor = "system" | "ai" | "recruiter";

/**
 * Collapses a granular `ApplicationState` into one of the six coarse
 * `CandidateStage` buckets the pipeline UI renders (funnel cards, stage
 * pills, the stage badge). Exhaustive by construction: adding a new
 * `ApplicationState` without mapping it here is a compile error, so a
 * candidate can never silently fall outside every bucket.
 *
 * Mapping rationale:
 *   - `screening_review_pending` stays under **Applied** — the resume is
 *     scored but the recruiter hasn't approved them *into* screening yet.
 *     The separate "Pending review" flag (awaiting_human_review) surfaces
 *     that they need action; approval moves them to **Screening**.
 *   - Post-interview states (`manager_review`, `final_interview_scheduling`)
 *     map to **Final Interview** — the HR + manager final round before Hired.
 *   - Failure / archived states map to **Rejected**: they're out of the active
 *     funnel and the coarse model has no dedicated bucket.
 */
export const APPLICATION_STAGE_BUCKET: Record<ApplicationState, CandidateStage> = {
  new: "applied",
  screening_review_pending: "applied",

  screening_approved: "screening",
  screening_sent: "screening",
  screening_completed: "screening",
  screening_scored: "screening",

  interview_scheduling: "interview",
  interview_scheduled: "interview",
  interview_completed: "interview",
  interview_scored: "interview",
  reference_check: "interview",

  manager_review: "final_interview",
  final_interview_scheduling: "final_interview",

  hired: "hired",

  rejected: "rejected",
  screening_expired: "rejected",
  interview_no_show: "rejected",
  processing_failed: "rejected",
  archived: "rejected",
};

/**
 * Map an application's canonical pipeline state to its coarse stage bucket.
 * Falls back to `applied` for any value outside the state machine (defensive
 * — the DB enum and `ApplicationState` are the source of truth).
 */
export function toCandidateStage(status: string): CandidateStage {
  return APPLICATION_STAGE_BUCKET[status as ApplicationState] ?? "applied";
}

// Which score stage a pipeline stage should display. Stages that don't produce
// a score of their own (interview scoring isn't built yet; final_interview is a
// human round; hired/rejected are terminal) map to null → the cell is blank.
const STAGE_SCORE_FOR: Record<CandidateStage, CandidateScore["stage"] | null> = {
  applied: "resume",
  screening: "screening",
  interview: "interview",
  final_interview: null,
  hired: null,
  rejected: null,
};

/**
 * The score to surface for a candidate in the pipeline: strictly the score for
 * their CURRENT stage. Returns null when that stage hasn't produced a score yet
 * (the cell shows "—") — we never fall back to an earlier stage's score, so a
 * resume score can't appear in a screening/interview row. Stage-specific by
 * design (see "Independent Stage Scores" in CLAUDE.md).
 */
export function pipelineDisplayScore(
  candidate: Pick<Candidate, "stage" | "scores">,
): CandidateScore | null {
  const target = STAGE_SCORE_FOR[candidate.stage];
  if (!target) return null;
  return candidate.scores.find((s) => s.stage === target) ?? null;
}

