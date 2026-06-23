import {
  APPLICATION_STATE_TRANSITIONS,
  type ApplicationState,
} from "@/lib/constants";

/**
 * States a recruiter may NOT set through a manual stage override, because each
 * asserts an artifact that only the candidate's action or the AI can
 * legitimately produce:
 *
 *   - screening_completed → a submitted candidate screening response exists
 *   - screening_scored    → an AI screening score is persisted as evidence
 *   - interview_scheduled  → the candidate booked a slot (a booking row exists)
 *   - interview_completed  → the interview actually took place (recording/transcript)
 *   - interview_scored     → an AI interview score is persisted
 *
 * Letting a recruiter jump straight to one of these fabricates pipeline state
 * with no evidence behind it — e.g. a "Scheduled" application with no booking,
 * or a "Screening Scored" one that was never answered. The system reaches these
 * states only after the real artifact is persisted (candidate responds →
 * `screening_completed`; candidate books → `interview_scheduled`).
 *
 * Routing decisions a recruiter SHOULD own are unaffected: reject, mark
 * `screening_expired` / `interview_no_show`, advance a scored candidate to
 * `interview_scheduling`, etc. — none of those assert a machine artifact.
 */
export const SYSTEM_PRODUCED_STATES: readonly ApplicationState[] = [
  "screening_completed",
  "screening_scored",
  "interview_scheduled",
  "interview_completed",
  "interview_scored",
];

/** Whether a recruiter may manually transition an application INTO `toState`. */
export function isRecruiterSettableTarget(toState: ApplicationState): boolean {
  return !SYSTEM_PRODUCED_STATES.includes(toState);
}

/**
 * The manual-override targets offered from `currentState`: the legal graph
 * transitions minus the system-produced states a recruiter can't fabricate.
 * Pure — drives both the stage-changer dropdown and the server-side guard.
 */
export function recruiterStageOptions(
  currentState: ApplicationState,
): ApplicationState[] {
  return (APPLICATION_STATE_TRANSITIONS[currentState] ?? []).filter(
    isRecruiterSettableTarget,
  );
}

/**
 * Guard for the manual stage-change action. Throws if a recruiter is trying to
 * set a system-produced state by hand. The dropdown already hides these, so
 * this is the server-side backstop against a stale page or a crafted request.
 */
export function assertRecruiterSettableTarget(toState: ApplicationState): void {
  if (!isRecruiterSettableTarget(toState)) {
    throw new Error(
      `"${toState}" can't be set manually — it reflects the candidate's response and AI scoring, which the system records automatically.`,
    );
  }
}
