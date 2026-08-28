import type { ApplicationState, Disposition } from "@/lib/constants";

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
  disposition?: Disposition;
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
 * Application states from which a recruiter may (re)send screening questions
 * to a single candidate: `screening_approved` (the legal predecessor of
 * `screening_sent`) and `screening_sent` itself, so an expired or lost link
 * can be resent.
 *
 * Every other state is ineligible — a candidate still in resume review,
 * awaiting human approval, already past screening, or in a terminal state
 * must NOT receive the screening email.
 */
export const SCREENING_SEND_ELIGIBLE_STATES = [
  "screening_approved",
  "screening_sent",
] as const satisfies readonly ApplicationState[];

/**
 * Predicate form of the send guard. Used by the UI to disable the "Send
 * questions" button for ineligible candidates; the action uses the
 * throwing `assertEligibleForScreeningSend` below as the real boundary.
 */
export function isEligibleForScreeningSend(status: ApplicationState): boolean {
  const eligible = SCREENING_SEND_ELIGIBLE_STATES as readonly ApplicationState[];
  return eligible.includes(status);
}

/**
 * Guard for the recruiter "send screening questions" path. The bulk sender
 * filters ineligible candidates out at the query level; the single-candidate
 * sender has no such filter, so this guard is what stops the screening email
 * from reaching someone who never made it into screening. Call it BEFORE the
 * email is dispatched — a failed post-send transition cannot un-send a mail.
 */
export function assertEligibleForScreeningSend(status: ApplicationState): void {
  if (!isEligibleForScreeningSend(status)) {
    throw new Error(
      `Screening questions can only be sent to a candidate who has been approved into screening. This application is currently "${status}".`,
    );
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

/**
 * Pure deadline check for voice screening (#83). A response is expired once
 * `now` is past `expires_at`. A null deadline (no expiry set) never expires.
 *
 * The caller reads this, and if true, flips the response row to `expired` and
 * transitions the application `screening_sent → screening_expired`. Kept pure
 * (no Date.now() inside) so tests pin both sides of the boundary.
 */
export function isResponseExpired(
  expiresAt: Date | null,
  now: Date,
): boolean {
  if (expiresAt === null) return false;
  return now.getTime() > expiresAt.getTime();
}


/**
 * Config slice the rule needs. Declared inline (rather than imported from
 * the data layer) so the rule's contract is self-describing and producers
 * conform to it — see `src/lib/rules/README.md`.
 */
export interface ScreeningScoringConfig {
  automation_mode: "fully_auto" | "human_in_loop";
  /**
   * The voice-screening stage's own pass mark. Distinct from the campaign's
   * `resume_threshold`, which belongs to the resume rule: a screening score
   * grades spoken answers and a resume score ranks CVs against a rubric, so the
   * two numbers do not mean the same thing and must not share a fail line.
   */
  screening_threshold: number;
}

/**
 * Rule layer — reads persisted screening-score evidence + campaign config
 * and returns the ordered transitions the action should apply. Pure: no AI
 * call, no DB.
 *
 * Always passes through `screening_scored` first so the audit log records
 * the AI scoring event before any downstream advancement.
 *
 *   - human_in_loop:           [screening_scored]
 *   - fully_auto + score ≥ thr: [screening_scored, interview_invited]
 *   - fully_auto + score < thr: [screening_scored]
 *
 * **The threshold advances; it does not reject** (decision 2026-08-22).
 * Passing it invites the candidate to the on-demand AI interview. Failing it
 * rests the application at `screening_scored` for a person to decide — the same
 * state HITL mode uses. `screening_scored` was added to the notification bell's
 * `AWAITING_DECISION_STATES` in the same change: a queue nobody can see is worse
 * than the auto-reject it replaced.
 *
 * It used to auto-reject below the line. Three reasons it no longer does:
 *
 * 1. **The volume is not where the leverage is.** The must-have gate and
 *    `resume_threshold` cut the pile before a screening link is ever sent, so
 *    auto-rejecting here saves a handful of review items — at the cost of never
 *    letting a person look at someone who held a live call with the product.
 * 2. **It contradicted the interview rule one stage later.** The interview never
 *    auto-rejects because "rejecting someone who sat a whole interview on the
 *    strength of one number is the decision most worth keeping human". A voice
 *    screening is the same thing in a milder form — degree, not kind.
 * 3. **The screening score is the most fragile number here.** The overall is the
 *    weighted mean over EVERY rubric dimension, and a dimension no question
 *    probes scores 0. The coverage check that prevents that is a model's
 *    reading. With auto-reject, a missed gap became a silent stack of
 *    rejections; without it, the same mistake becomes a queue somebody notices.
 *
 * The counter-argument is real and was weighed: unlike the interview, the
 * screening transcript IS persisted, so a rejection here is auditable. That
 * makes an automatic rejection recoverable, not correct, at these volumes.
 *
 * The resume stage still auto-rejects in both modes — a must-have is objective
 * and checkable against a document, and it is where the funnel actually is.
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
        toState: "interview_invited",
        rationale: `${scoreLine} — passed, advancing to AI interview`,
      },
    ];
  }

  // Below the line rests rather than rejecting. The rationale says so, because
  // the audit log is where a recruiter finds out why an application stopped.
  return [
    {
      ...recordScored,
      rationale: `${scoreLine} — below threshold, awaiting a human decision`,
    },
  ];
}
