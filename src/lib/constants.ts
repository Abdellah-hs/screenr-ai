import type { DeterministicResumeScoreResult } from "@/lib/resume-scoring/deterministic";

// ─── Campaign Types ──────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "active" | "paused" | "closed";
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

// SLA timers run against the coarse pipeline BUCKETS a candidate actually waits
// in (the `CandidateStage` buckets), not the rubric stages (resume / screening_q
// / interview). Terminal buckets (`hired`, `rejected`) carry no SLA.
export type SlaStage = "applied" | "screening" | "interview" | "final_interview";

/**
 * How badly an application has overrun its stage SLA. Defined here rather than
 * in `rules/sla.ts` so `Candidate` can carry one without the domain types
 * importing the rules module — `rules/sla.ts` re-exports it, so existing
 * importers are unaffected.
 */
export type SlaBreachLevel = "alert" | "escalation";

export interface SlaTimer {
  stage: SlaStage;
  time_limit_hours: number;
  alert_threshold_hours: number;
  escalation_threshold_hours: number;
}

// One weekly final-interview availability rule. `weekday` is
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
  /** Whether the public apply page accepts NEW applications while active. The
   *  manual intake switch behind the "Active — accepting / not accepting"
   *  dropdown options. Only meaningful when status is `active`. */
  accepting_applications: boolean;
  deadline: string | null;
  /** When true, the public apply page stops accepting applications after the
   *  deadline day passes. When false the deadline is informational only. */
  deadline_enforced: boolean;
  location: string | null;
  timezone: string | null;
  /** URL-safe slug for the public apply page (`/apply/<slug>`). */
  public_slug: string | null;
  automation_mode: AutomationMode;
  /** Pass mark (0-100) for the CV stage. */
  resume_threshold: number;
  /** Pass mark (0-100) for the voice-screening stage. Separate from
   *  `resume_threshold` because the two scores are different kinds of number —
   *  one ranks CVs against a rubric, the other grades spoken answers. */
  screening_threshold: number;
  interview_persona: InterviewPersona;
  rubrics: EvaluationRubric[];
  reviewers: CampaignReviewer[];
  sla_timers: SlaTimer[];
  // Final-interview availability config (candidate slot booking).
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
];

/**
 * Recruiter-facing status options for the campaign form. The two "Active —"
 * rows both map to the `active` lifecycle status, split by the
 * `accepting_applications` flag, so the dropdown reads intuitively.
 * `active_no_intake` is a UI-only token, decoded to
 * `{ status: "active", accepting_applications: false }` server-side (see
 * encode/decodeStatusSelection in `src/lib/rules/campaign-status.ts`).
 */
export type CampaignStatusSelection =
  | "draft"
  | "active"
  | "active_no_intake"
  | "paused"
  | "closed";

export const CAMPAIGN_STATUS_SELECTIONS: {
  value: CampaignStatusSelection;
  label: string;
}[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active — accepting applications" },
  { value: "active_no_intake", label: "Active — not accepting new applications" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
];

export const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  closed: "bg-red-100 text-red-700",
};

/**
 * Default pass mark for both scored gates (resume and voice screening) when a
 * form omits one. Kept here so the campaign wizard, the edit form and the Zod
 * parser cannot drift apart, and matched to the column defaults in
 * `20260821120000_split_resume_screening_thresholds.sql`.
 */
export const DEFAULT_SCORE_THRESHOLD = 70;

// The mode says whether a rule may act on a score without waiting for a person.
// It does NOT hand the pipeline to the AI: the AI scores identically in both
// modes and transitions nobody in either — see "AI Usage Rules" in CLAUDE.md.
// Copy here used to read "AI handles the entire pipeline autonomously", which
// described a product this one deliberately is not.
export const AUTOMATION_MODES: { value: AutomationMode; label: string; description: string }[] = [
  { value: "fully_auto", label: "Fully Automatic", description: "Candidates advance on your thresholds without anyone approving first" },
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

// The stages an SLA timer can target — the non-terminal pipeline buckets a
// candidate can stall in. Mirrors PIPELINE_STAGES minus the terminal `hired`.
export const SLA_STAGES: { name: string; key: SlaStage }[] = [
  { name: "New", key: "applied" },
  { name: "Screening", key: "screening" },
  { name: "Interview", key: "interview" },
  { name: "Final Interview", key: "final_interview" },
];

// ─── AI Audit Trail ─────────────────────────────────────────────────────────

/**
 * The `stage` values written to `ai_audit_log`, one per sanctioned writer.
 *
 * This is a plain text column, so the list is a convention rather than a DB
 * constraint — it exists to drive the Audit Log filter without hard-coding
 * strings in the UI. Adding a new AI call means adding its stage here too, or
 * its rows become unfilterable (still logged, just harder to find).
 */
export const AI_AUDIT_STAGE_VALUES = [
  "resume_parsing",
  "resume_resubmission",
  "resume_scoring",
  "screening_scoring",
  "interview_scoring",
] as const;

export type AiAuditStage = (typeof AI_AUDIT_STAGE_VALUES)[number];

/**
 * Audit rows per page. Lives here rather than in the action module because a
 * `"use server"` file may only export async functions, and both the page and the
 * client table need this number to size their pager.
 */
export const AUDIT_PAGE_SIZE = 50;

export const AI_AUDIT_STAGES: { value: AiAuditStage; label: string }[] = [
  { value: "resume_parsing", label: "Résumé parsing" },
  { value: "resume_resubmission", label: "Résumé resubmission" },
  { value: "resume_scoring", label: "Résumé scoring" },
  { value: "screening_scoring", label: "Screening scoring" },
  { value: "interview_scoring", label: "Interview scoring" },
];

// ─── Voice Screening ────────────────────────────────────────────────────────

/**
 * How long one ANSWER may take, measured from the candidate's FIRST WORD.
 *
 * This is the pacing lever for the whole call (decision 2026-08-24, replacing
 * the global clock). Every question — a primary topic or a follow-up — gets its
 * own minute, and the call lasts as long as its questions take.
 *
 * **One clock per question, armed when the question has been asked, and it only
 * ever counts down** (decision 2026-08-25). Speech does not restart it.
 *
 * It used to start on the candidate's first word instead, so thinking time was
 * free — and the counter therefore JUMPED UP when they began speaking, from
 * whatever the silence fallback had left to a fresh minute. On screen that is a
 * timer running backwards, which reads as broken however generous it actually
 * is, and it was reported as a bug by the first person to watch a real call.
 *
 * The cost is real and was accepted: seconds spent deciding what to say now
 * come out of the answer. A minute is generous enough to absorb it — the
 * competency answer this stage looks for runs 30-45 seconds — and one honest
 * falling number beats two clocks that are individually correct and jointly
 * incomprehensible.
 *
 * The onset is still recorded (`answerStartedAt`) because "how long they took
 * to start" is useful evidence on the transcript. It simply no longer moves the
 * deadline.
 *
 * It replaced a fixed call budget that was a guillotine by construction: one
 * clock over the whole call meant a slow first answer was silently paid for by
 * the LAST topic, which then went unasked and scored the candidate zero on
 * whatever the rubric graded it against. A per-answer budget puts the cost of a
 * rambling answer on that answer, where it belongs, and it cannot reach the
 * topics behind it.
 *
 * A minute is generous rather than tight: the competency answer this stage is
 * looking for runs 30–45 seconds, so most answers end well inside it and the
 * budget only ever bites on someone who has genuinely lost the thread.
 */
/**
 * The languages a candidate may hold their screening call in.
 *
 * **Chosen by the candidate before the call opens, never by the model.** The
 * interviewer is given their name and a summary of their CV, and left to decide
 * it would read those and infer one — which is how a candidate who wanted
 * English was greeted in French before they had said a word.
 *
 * It is a closed set because the value ends up inside the interviewer's own
 * instructions. Anything a candidate can put in a prompt has to be one of a
 * fixed list, never text they supplied.
 */
export const CALL_LANGUAGES = ["english", "french"] as const;

export type CallLanguage = (typeof CALL_LANGUAGES)[number];

/** What the candidate sees on the pre-call screen, in the language itself. */
export const CALL_LANGUAGE_LABELS: Record<CallLanguage, string> = {
  english: "English",
  french: "Français",
};

/** The language a call runs in when the candidate has not chosen. */
export const DEFAULT_CALL_LANGUAGE: CallLanguage = "english";

export const SCREENING_ANSWER_BUDGET_MS = 60_000;

/**
 * The absolute ceiling on a screening room, in minutes. Nothing quotes it,
 * nothing displays it, and a normal call never approaches it.
 *
 * It is NOT a pacing device — that is `SCREENING_ANSWER_BUDGET_MS`. It is the
 * safety net for the failures pacing cannot reach: a worker that dies mid-call,
 * a model that loops without ever closing, a candidate who walks away with the
 * tab open. Each of those leaves an OpenAI Realtime session billing by the
 * minute and a candidate with no way out, so a bound has to exist even though
 * the candidate must never feel one.
 *
 * Deliberately far above any real call, and the arithmetic is worth stating
 * because it is larger than it looks. Eight topics with a follow-up each is
 * sixteen questions; every one of them may run its full minute AND spend its
 * grace period, which is twenty-four minutes of answering before the
 * interviewer has said a word. Thirty is the first round number clear of that
 * — a bound set below it would start cutting legitimate calls short, which is
 * the guillotine this whole change removed.
 *
 * It also says something the recruiter should hear: an eight-topic rubric is a
 * twenty-minute conversation in the worst case. The remedy is fewer topics,
 * which is what `checkScreeningQuestionCoverage` already pushes.
 *
 * This is also the constant that retired the old `MAX_SCREENING_CALL_MINUTES <=
 * INTERVIEW_DURATION_MINUTES` invariant. That bound said the cheap filter must
 * not outrun the deep stage, which was the right rule while screening had a
 * fixed length. It no longer has one: the EXPECTED call is
 * `screeningCallEstimateMinutes` — about seven minutes at five topics, still
 * comfortably under the interview — and the number below is a failure bound,
 * not a duration. Asserting a failure bound against a duration would compare
 * two different kinds of thing and would force the safety net down to a value
 * where it stopped being a safety net.
 */
export const SCREENING_CALL_BACKSTOP_MINUTES = 30;

/**
 * Roughly how long a screening call covering `topicCount` topics takes — an
 * ESTIMATE shown to the candidate, never a limit enforced on them.
 *
 * The distinction is the entire point of the split. This number appears in the
 * invitation email and on the pre-call screen so nobody starts a call without
 * knowing what they are agreeing to; no timer is derived from it, and running
 * over it costs the candidate nothing. Before 2026-08-24 one function fed both
 * the copy AND the hard cut, so "about 5 minutes" was a promise and a threat in
 * the same sentence.
 *
 * A minute a topic (the answer budget) plus two for the greeting, the goodbye,
 * and the follow-ups that land on some topics but not all. The floor stops a
 * three-topic call advertising itself as shorter than the setup it asks for —
 * finding a quiet room and sorting out a microphone is not worth doing for
 * three minutes.
 */
export function screeningCallEstimateMinutes(topicCount: number): number {
  return Math.max(5, topicCount + 2);
}
/*
 * `TWO_FOLLOWUP_TOPIC_LIMIT` and `maxFollowUpsForTopicCount` were REMOVED with
 * follow-ups themselves (decision 2026-08-27). A screening call is one
 * question, one answer, the next question — so there is no allowance to size,
 * and a constant naming a rule that no longer exists is worse than no constant.
 *
 * The reasoning they carried is still worth keeping, because it is what a
 * future probe feature would have to answer: every answer costs the same minute
 * (`SCREENING_ANSWER_BUDGET_MS`), so a probe is not paid for out of a shared
 * clock — it is simply one more answer the candidate sits through. At eight
 * topics, two probes each would be twenty-four questions and a call as long as
 * the AI interview, which is the wrong shape for a screen.
 */

/**
 * How much of the BACKSTOP is held back for covering whatever is still unasked.
 *
 * Crossing this line puts the interviewer into wrap-up: no more follow-ups,
 * raise each remaining topic once, close warmly.
 *
 * Since 2026-08-24 this is a last resort rather than the normal shape of the
 * ending. A call is paced per answer and ends when its topics are covered, so
 * it should reach its own natural close long before the backstop comes into
 * view. The reserve still exists because the backstop still exists: if a call
 * ever does run all the way to `SCREENING_CALL_BACKSTOP_MINUTES`, arriving
 * there mid-sentence with three topics unasked is strictly worse than arriving
 * having raised them, and everything unasked when the room closes scores the
 * candidate zero on whatever the rubric graded it against.
 */
export const SCREENING_WRAP_UP_RESERVE_MS = 60_000;

// ─── AI Video Interview ─────────────────────────────────────────────────────

/**
 * How long a candidate's AI video interview runs, in minutes.
 *
 * Single source of truth on purpose. Three things have to agree about this
 * number — the client's hard cap, the copy the candidate reads before starting,
 * and the pacing the interviewer is instructed to keep — and when they were
 * three separate literals they drifted: the call was capped at 20 minutes while
 * the interviewer was being told to wrap up in 10–15, so a candidate could be
 * cut off mid-answer or left in silence after the agent had said goodbye.
 */
export const INTERVIEW_DURATION_MINUTES = 10;

/**
 * How many main questions the interviewer should plan for.
 *
 * The instructions carry this alongside the minute budget because a realtime
 * model has no clock — it cannot feel time passing, so "keep it under 10
 * minutes" is guidance it cannot actually follow. It CAN count its own
 * questions, which makes this the constraint that does the work. Roughly two
 * minutes per question and its follow-ups.
 */
export const INTERVIEW_TARGET_QUESTIONS = 5;

// ─── Candidate Types ────────────────────────────────────────────────────────

export type CandidateStage = "applied" | "screening" | "interview" | "final_interview" | "hired" | "rejected";
/**
 * The band shown next to a stage score.
 *
 * Two vocabularies live here on purpose. Resume screening now returns
 * `eligible` / `ineligible`, because a must-have gate has no middle: calling
 * someone who missed a non-negotiable requirement "moderate" invites an
 * argument about the gate. The four graded values remain for stages that really
 * are a scale, and for the history already stored under them.
 */
export type ScreeningTier =
  | "strong"
  | "moderate"
  | "weak"
  | "no_match"
  | "eligible"
  | "ineligible";

export interface ScoreFactor {
  name: string;
  weight: number;
  score: number;
}

export interface CandidateScore {
  stage: "resume" | "screening" | "interview";
  /**
   * Null for an ineligible resume: they failed a must-have, so there is no
   * ranking score. A number here would be read as "how close they were", which
   * is the comparison a gate exists to refuse.
   */
  overall: number | null;
  tier?: ScreeningTier;
  ai_summary: string;
  /** Legacy weighted breakdown. Present only on scores from before #? evidence screening. */
  factors: ScoreFactor[];
  /**
   * The evidence-based resume evaluation: per-criterion levels, verified quotes,
   * and every failed must-have. Null for screening/interview scores and for
   * resume scores produced by the old weighted scorer.
   */
  evaluation: DeterministicResumeScoreResult | null;
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
  /**
   * The raw application state, alongside the coarse `stage` bucket derived from
   * it. The table needs both: `stage` drives the funnel pills, but any decision
   * about what a candidate can legally do next — bulk advance, most of all —
   * has to be made against the exact state, not the bucket six states share.
   */
  status: ApplicationState;
  // Derived from raw application.status === "screening_review_pending".
  // Surfaced as a boolean (not a stage value) because HITL-pending is a
  // workflow flag — the HITL review panel resolves it, not the recruiter's
  // manual stage changer.
  awaiting_human_review: boolean;
  // Derived from raw application.status === "archived". Archived applications
  // live in the `rejected` coarse bucket, so this flag is what lets the
  // candidate list split them into their own "Archived" group.
  is_archived: boolean;
  /**
   * SLA breach for the stage this application is sitting in, or null when the
   * campaign has no timer for that stage, the stage is terminal, or nothing has
   * overrun yet.
   *
   * Computed server-side, deliberately. `hoursInStage` reads the clock, and a
   * client component recomputing it after hydration would disagree with what
   * the server rendered.
   */
  sla: { level: SlaBreachLevel; hours: number } | null;
  scores: CandidateScore[];
  resume: {
    skills: string[];
    experience_years: number;
    education: string;
  };
  applied_at: string;
  updated_at: string;
}

/**
 * A stage score as a LIST needs it: the number and its tier, and nothing of the
 * evidence behind it.
 *
 * The candidates table renders `overall` and `tier` in one cell. It has never
 * rendered `ai_summary`, `factors`, or `evaluation` — and `evaluation` is the
 * whole evidence-based resume result, every criterion with its verified quotes.
 * Loading those to draw a two-digit number meant pulling them out of Postgres
 * and then serialising them into the RSC payload for a client component that
 * ignores them.
 *
 * A narrower type rather than nulls in the wide one, deliberately. A null
 * `evaluation` already means something here — "this score came from the old
 * weighted scorer" — so reusing it for "we did not load it" would make an
 * absence of evidence indistinguishable from evidence of absence. Reading the
 * evidence off a list row is now a type error, which is the correct answer:
 * fetch the candidate.
 */
export type CandidateListScore = Pick<CandidateScore, "stage" | "overall" | "tier">;

/**
 * A candidate as the campaign's candidates table needs them. A structural
 * subset of `Candidate`, so anything holding a full one can still be passed to
 * a function that takes this.
 */
export type CandidateListRow = Pick<
  Candidate,
  | "id"
  | "campaign_id"
  | "name"
  | "email"
  | "current_title"
  | "current_company"
  | "stage"
  | "status"
  | "awaiting_human_review"
  | "is_archived"
  | "sla"
  | "applied_at"
  | "updated_at"
> & { scores: CandidateListScore[] };

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
  no_match: "bg-red-200 text-red-800",
  eligible: "bg-green-100 text-green-700",
  ineligible: "bg-red-100 text-red-700",
};

/**
 * Human-facing tier names. The DB enum value stays `moderate` — only the label
 * changes, so no migration is involved and stored rows are untouched.
 *
 * "Potential Match" is PRD language: `moderate` reads like a verdict on the
 * candidate, where the tier is only a band derived from a score. Every surface
 * MUST render through this map rather than prettifying the raw enum, or a
 * rename like this one silently misses that surface.
 */
export const TIER_LABELS: Record<ScreeningTier, string> = {
  strong: "Strong",
  moderate: "Potential Match",
  weak: "Weak",
  no_match: "No Match",
  eligible: "Eligible",
  ineligible: "Ineligible",
};

export const STAGE_ORDER: CandidateStage[] = ["applied", "screening", "interview", "final_interview", "hired"];

/**
 * The two buckets that are an OUTCOME rather than a position in the pipeline.
 *
 * `toCandidateStage` folds every terminal application state into one of these,
 * so they are where a candidate stops being "in play" — which is the split the
 * overview's rail and its "N in play" figure are both built on.
 */
export const TERMINAL_CANDIDATE_STAGES: CandidateStage[] = ["hired", "rejected"];

/** The stages somebody can still be moving through. */
export const IN_PLAY_CANDIDATE_STAGES: CandidateStage[] = STAGE_ORDER.filter(
  (stage) => !TERMINAL_CANDIDATE_STAGES.includes(stage),
);

/**
 * How many candidates are still moving, given one campaign's stage buckets.
 *
 * Derived from {@link IN_PLAY_CANDIDATE_STAGES} rather than written out as a
 * sum, because a hand-written sum fails SILENTLY when a stage is added: the new
 * bucket is simply left out, and the figure then disagrees with the total minus
 * the outcome rows printed on the same card, with nothing to say which is
 * wrong.
 */
export function inPlayCandidateCount(buckets: Record<CandidateStage, number>): number {
  return IN_PLAY_CANDIDATE_STAGES.reduce((total, stage) => total + (buckets[stage] ?? 0), 0);
}

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
  | "interview_invited"
  // Deprecated slot-booking pair — unreachable for new applications; kept for
  // in-flight rows until a cleanup migration drops the enum values.
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
  | "interview_expired"
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
  screening_scored: ["interview_invited", "rejected"],

  // On-demand AI interview: invited via a token link → completed or expired.
  // This is the only path out of screening — slot booking now belongs to the
  // final human interview (`final_interview_scheduling`), per the 2026-06-23
  // decision superseding PRD 3.5.6.
  // The interim `manager_review` shortcut (for interviews run off-platform
  // while the AI interview didn't exist) was removed once the interview
  // shipped: an invited candidate now reaches `manager_review` only by
  // actually interviewing, so the state always has a transcript behind it.
  interview_invited: ["interview_completed", "interview_expired", "rejected"],

  // DEPRECATED slot-booking pair — no inbound edges remain, so new applications
  // can't enter. The keys (and their outbound edges) stay until a cleanup
  // migration retires the enum values, so in-flight applications keep working.
  interview_scheduling: ["interview_scheduled", "rejected"],
  interview_scheduled: ["interview_completed", "interview_no_show", "rejected"],
  interview_completed: ["interview_scored", "processing_failed", "rejected"],
  interview_scored: ["reference_check", "manager_review", "rejected"],

  // Post-interview
  reference_check: ["manager_review", "rejected"],
  manager_review: ["final_interview_scheduling", "hired", "rejected"],
  final_interview_scheduling: ["hired", "rejected"],

  // Failure states — observable dead-ends; archiving is the only exit, and
  // it is reversible (see `archived` below).
  screening_expired: ["archived"],
  interview_no_show: ["archived"],
  interview_expired: ["archived"],
  /**
   * The one failure state with a way back, because it is the only one that is
   * OUR fault rather than a fact about the candidate.
   *
   * The others record something that happened in the world and cannot be
   * un-happened: a link ran out, a window closed, somebody did not turn up.
   * `processing_failed` records that our extractor timed out or a model was
   * down while a real person's CV sat there unread. When that clears, the
   * honest state is the one a working ingest would have produced — `new`,
   * unscored, with the scoring rule still to run.
   *
   * `new` is the only edge deliberately. Routing a repair straight to a scored
   * or approved state would let it skip the rule that owns that decision.
   */
  processing_failed: ["new", "archived"],

  // Terminal — only `archived` is reachable from them (for housekeeping),
  // and an archive can be undone back to here.
  rejected: ["archived"],
  hired: ["archived"],
  /**
   * Archiving is reversible (PRD 3.12.4): a manager can bring someone back.
   *
   * The exits are exactly the states that can archive, so un-archiving is an
   * undo rather than a new route through the machine. This map only says the
   * shape is legal — `unarchiveApplication` additionally requires the target to
   * be the state the application ACTUALLY came from, read back off the
   * transitions log, so archived can never be used as a shortcut into a state
   * the candidate never reached.
   */
  archived: [
    "screening_expired",
    "interview_no_show",
    "interview_expired",
    "processing_failed",
    "rejected",
    "hired",
  ],
};

export type TransitionActor = "system" | "ai" | "recruiter";

// ─── Disposition Codes ──────────────────────────────────────────────────────

/**
 * Why an application closed. Required on every terminal transition (see
 * CLAUDE.md → Disposition Codes).
 *
 * These exist because free-text rationale is not countable. "How many did we
 * reject on resume score this quarter?" is unanswerable when the automatic
 * paths say "below threshold" and a manager says "not strong enough" — the
 * same outcome, worded differently every time. The code is the queryable half;
 * the description stays free text and carries the specifics.
 *
 * Codes are deliberately coarse. A long tail of narrow codes would push the
 * recruiter back into judgement calls at the exact moment we want a
 * mechanical answer, and the detail belongs in the description anyway.
 */
export const DISPOSITION_CODES = [
  "LOW_SCORE",
  "FAILED_INTERVIEW",
  "NO_SHOW",
  "EXPIRED",
  "OVERRIDE_REJECTED",
] as const;

export type DispositionCode = (typeof DISPOSITION_CODES)[number];

export interface Disposition {
  code: DispositionCode;
  description: string;
}

export const DISPOSITION_LABELS: Record<DispositionCode, string> = {
  LOW_SCORE: "Score below threshold",
  FAILED_INTERVIEW: "Did not pass interview",
  NO_SHOW: "Did not attend",
  EXPIRED: "Deadline passed",
  OVERRIDE_REJECTED: "Recruiter decision",
};

/**
 * The states that close an application for good. Entering one requires a
 * disposition; every other transition may omit it.
 *
 * `hired` is deliberately absent. It is terminal, but "why did this close?"
 * has one answer there and it is the outcome itself — asking a recruiter to
 * categorise a hire would be bureaucracy with no query behind it.
 */
export const DISPOSITION_REQUIRED_STATES: ApplicationState[] = ["rejected", "archived"];

export function requiresDisposition(toState: ApplicationState): boolean {
  return DISPOSITION_REQUIRED_STATES.includes(toState);
}

/**
 * Waiting on a person to decide, after the AI has taken it as far as it can.
 *
 * - `screening_scored` — the screening threshold advances but no longer
 *   rejects (2026-08-22), so a below-the-line candidate rests here for a
 *   person rather than being closed out.
 * - `interview_scored` — HITL; the recruiter must advance it.
 * - `manager_review` — a manager owes a decision.
 *
 * Surfaced regardless of automation mode: the failure is the same in either, a
 * scored candidate nobody looks at, waiting on a person who does not know they
 * are the bottleneck.
 *
 * Lives here because three separate readers must agree on it — the
 * notification bell (`data/notifications.ts`), the campaign list's attention
 * column (`campaigns/board-view.ts`) and the overview queue
 * (`overview/decision-queue.ts`). It was three copies with three comments
 * telling the reader to keep them in step, and they had already drifted:
 * `screening_scored` reached the first two and was missed by the third, so the
 * bell counted work the overview never named.
 */
export const AWAITING_DECISION_STATES: ApplicationState[] = [
  "screening_scored",
  "interview_scored",
  "manager_review",
];

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

  interview_invited: "interview",
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
  interview_expired: "rejected",
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
/**
 * Which stage's score a candidate sitting in this bucket shows, or null when
 * the bucket has no reading of its own — the final human interview is a
 * person's judgement, and hired/rejected are outcomes rather than sittings.
 *
 * The same map `pipelineDisplayScore` selects with, exposed so the candidates
 * table can decide whether a Score column is worth drawing at all and what to
 * call it. Reading the one map keeps the two answers from drifting: a column
 * can never promise a number the selector would never return.
 *
 * Takes a `string` on purpose — its callers hold filter pills and URL params,
 * not a narrowed union, and anything that is not a bucket has no score.
 */
export function stageScoreKind(stage: string): CandidateScore["stage"] | null {
  return STAGE_SCORE_FOR[stage as CandidateStage] ?? null;
}

export function pipelineDisplayScore<S extends Pick<CandidateScore, "stage">>(
  candidate: { stage: CandidateStage; scores: readonly S[] },
): S | null {
  const target = STAGE_SCORE_FOR[candidate.stage];
  if (!target) return null;
  return candidate.scores.find((s) => s.stage === target) ?? null;
}

// ─── Talent Pool ────────────────────────────────────────────────────────────
// The Talent Pool is people-first: candidates live independent of any single
// campaign (CLAUDE.md "Talent Pool"). Each person carries their application
// history — one entry per campaign they applied through — so removing a
// campaign never hides the person; it just flags that origin as removed.

/** One campaign a person applied through, with its current-stage evidence. */
export interface TalentPoolApplication {
  applicationId: string;
  campaignId: string;
  campaignTitle: string;
  campaignStatus: CampaignStatus;
  /** The owning campaign has been soft-removed — surfaced, never hidden. */
  campaignRemoved: boolean;
  stage: CandidateStage;
  /** Stage-appropriate score (resume/screening/…), or null if none yet. */
  score: { overall: number | null; stage: CandidateScore["stage"]; tier: ScreeningTier | null } | null;
  appliedAt: string;
}

/** A person in the Talent Pool, with every campaign they've applied to. */
export interface TalentPoolCandidate {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  applications: TalentPoolApplication[];
  /** Most recent application date across their history — drives list order. */
  latestActivityAt: string;
}


// ─── Curated Talent Pool (PRD 3.11) ─────────────────────────────────────────
//
// Distinct from `TalentPoolCandidate` above, and the distinction is the whole
// point of issue #141: that type is the *directory* — everyone who ever applied,
// assembled automatically. This one is the *pool* — people a recruiter
// deliberately marked as worth revisiting. A directory answers "who applied";
// a pool answers "who would I call first when the next role opens".

/** Ceiling on tags per entry — a taxonomy nobody can scan is not a taxonomy. */
export const MAX_POOL_TAGS = 12;
export const MAX_POOL_TAG_LENGTH = 40;
export const MAX_POOL_NOTES_LENGTH = 2000;

/** One curated entry, carrying every field the 3.11.2 filter set searches. */
export interface TalentPoolEntry {
  /** The pool entry's own id — not the candidate's, not the application's. */
  id: string;
  candidateId: string;
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  /** Role signal lifted from the resume ("Senior Backend Engineer"). */
  headline: string | null;
  /** Skills from the most recently parsed resume — the 3.11.2 "skills" axis. */
  skills: string[];
  tags: string[];
  notes: string | null;
  addedAt: string;
  /**
   * Where the recruiter was standing when they pooled this person. Nullable
   * because the pool outlives the campaign that filled it — a hard-deleted
   * campaign nulls the reference rather than taking the entry with it.
   */
  sourceApplicationId: string | null;
  sourceCampaignId: string | null;
  sourceCampaignTitle: string | null;
  /**
   * Best score this person reached at ANY stage of ANY application.
   *
   * A deliberate exception to "no composite master score": this is not a rollup
   * used to decide anything — it is a search axis over history, and "show me
   * everyone who ever scored above 80" is the question 3.11.2 actually asks.
   * The stage-specific evidence is one click away on the candidate page.
   */
  bestScore: number | null;
  /** Every campaign this person applied to — the "original campaign" axis. */
  campaigns: { id: string; title: string }[];
}

/** The 3.11.2 filter set. Every field optional; unfiltered is the default view. */
export interface TalentPoolFilters {
  /** Free text across name, email, headline, skills, tags and notes. */
  query: string;
  /** Tags that must ALL be present — tags narrow, they do not widen. */
  tags: string[];
  campaignId: string | null;
  minScore: number | null;
  maxScore: number | null;
  /** `YYYY-MM-DD`, inclusive on both ends. */
  addedFrom: string | null;
  addedTo: string | null;
}

export const EMPTY_TALENT_POOL_FILTERS: TalentPoolFilters = {
  query: "",
  tags: [],
  campaignId: null,
  minScore: null,
  maxScore: null,
  addedFrom: null,
  addedTo: null,
};

// ─── Application State Presentation ─────────────────────────────────────────

/**
 * A canonical enum value as a human label: `screening_approved` → "Screening
 * Approved".
 *
 * Here rather than in a component because two of them now render state names
 * (the stage changer and the activity timeline), and a candidate whose history
 * spells a state differently from the control that set it reads as two
 * different states.
 */
export function formatApplicationState(state: ApplicationState): string {
  return state
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Who caused a transition, in the recruiter's words. */
export const TRANSITION_ACTOR_LABELS: Record<TransitionActor, string> = {
  // "Automated" rather than "System": from the recruiter's side the difference
  // between a rule firing and a cron sweep firing is not one they can act on.
  system: "Automated",
  ai: "AI",
  recruiter: "You",
};
