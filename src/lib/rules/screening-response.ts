import type { ApplicationState } from "@/lib/constants";

export type ScreeningResponseStatus =
  | "pending"
  | "sent"
  | "responded"
  | "scored"
  | "expired";

/**
 * A deferred state-machine transition. The rule layer returns one of these;
 * the caller is responsible for executing it via `transitionApplication`.
 * Mirrors `TransitionDescriptor` in `./resume-scoring.ts` — kept local to
 * each rules module so producers can't accidentally couple across decisions.
 */
export interface TransitionDescriptor {
  toState: ApplicationState;
  rationale: string;
}

/**
 * Thrown by rules in this module when a candidate-facing precondition
 * fails. The `message` is the string the candidate sees, so it must
 * remain stable — public tests pin it verbatim.
 */
export class ScreeningResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningResponseError";
  }
}

/**
 * Guard for the form-load path: a candidate can only open their form
 * if the response row is still accepting input.
 *   - `scored`  → already processed by the recruiter; nothing to do.
 *   - `expired` → deadline passed; a recruiter has to issue a new link.
 */
export function assertResponseIsOpen(status: ScreeningResponseStatus): void {
  if (status === "scored") {
    throw new ScreeningResponseError(
      "Your answers have already been submitted and reviewed. Thank you!",
    );
  }
  if (status === "expired") {
    throw new ScreeningResponseError(
      "This link has expired. Please contact the hiring team for a new one.",
    );
  }
}

/**
 * Guard for the submit path: prevents a candidate from re-submitting
 * after their answers have been scored. (Other statuses — pending,
 * sent, responded — are all valid entry points for a submission; the
 * caller is responsible for persisting idempotently.)
 */
export function assertResponseNotResubmitted(status: ScreeningResponseStatus): void {
  if (status === "scored") {
    throw new ScreeningResponseError(
      "Your answers have already been submitted. You cannot re-submit.",
    );
  }
}

interface QuestionWithRequiredFlag {
  id: string;
  is_required: boolean;
}

interface AnswerRef {
  question_id: string;
}

/**
 * Ensures every required question has a corresponding answer in the
 * submission. Non-empty-string validation is Zod's responsibility
 * upstream; this rule only cares about presence.
 */
export function validateRequiredAnswersPresent(
  questions: QuestionWithRequiredFlag[],
  answers: AnswerRef[],
): void {
  const answered = new Set(answers.map((a) => a.question_id));
  const missingRequired = questions.filter(
    (q) => q.is_required && !answered.has(q.id),
  );
  if (missingRequired.length > 0) {
    throw new ScreeningResponseError(
      `Please answer every required question before submitting (${missingRequired.length} missing).`,
    );
  }
}

/**
 * Config slice the rule needs. Declared inline (rather than imported from
 * the data layer) so the rule's contract is self-describing and producers
 * conform to it — see `src/lib/rules/README.md`.
 */
export interface ScreeningScoringConfig {
  automation_mode: "fully_auto" | "human_in_loop";
  screening_threshold: number;
}

/**
 * Rule layer — reads persisted screening-score evidence + campaign config
 * and returns the ordered transitions the action should apply. Pure: no AI
 * call, no DB.
 *
 * Always passes through `screening_scored` first so the audit log records
 * the AI scoring event before any downstream advancement. In auto mode it
 * then chains a second transition to either `interview_scheduling` (pass)
 * or `rejected` (fail). HITL mode rests at `screening_scored` for the
 * recruiter to advance manually.
 *
 *   - human_in_loop:           [screening_scored]
 *   - fully_auto + score ≥ thr: [screening_scored, interview_scheduling]
 *   - fully_auto + score < thr: [screening_scored, rejected]
 */
export function evaluateScreeningScoringOutcome(
  result: { overall_score: number },
  config: ScreeningScoringConfig,
): TransitionDescriptor[] {
  const scoreLine = `Screening score ${result.overall_score} vs threshold ${config.screening_threshold}`;

  const recordScored: TransitionDescriptor = {
    toState: "screening_scored",
    rationale: `${scoreLine} — recorded`,
  };

  if (config.automation_mode === "human_in_loop") {
    return [recordScored];
  }

  if (result.overall_score >= config.screening_threshold) {
    return [
      recordScored,
      {
        toState: "interview_scheduling",
        rationale: `${scoreLine} — passed, advancing to interview scheduling`,
      },
    ];
  }

  return [
    recordScored,
    {
      toState: "rejected",
      rationale: `${scoreLine} — below threshold`,
    },
  ];
}
