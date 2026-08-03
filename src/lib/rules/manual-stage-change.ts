import {
  APPLICATION_STATE_TRANSITIONS,
  type ApplicationState,
} from "@/lib/constants";

/**
 * States a recruiter may NOT set through a manual stage override, because each
 * asserts an artifact that only the candidate's action or the AI can
 * legitimately produce:
 *
 *   - screening_sent       → the questions email was sent + a response row created
 *   - screening_completed → a submitted candidate screening response exists
 *   - screening_scored    → an AI screening score is persisted as evidence
 *   - interview_scheduled  → the candidate booked a slot (a booking row exists)
 *   - interview_completed  → the interview actually took place (recording/transcript)
 *   - interview_scored     → an AI interview score is persisted
 *
 * Letting a recruiter jump straight to one of these fabricates pipeline state
 * with no evidence behind it — e.g. a "Scheduled" application with no booking,
 * or a "Screening Sent" one where no email ever went out. The system reaches
 * these states only after the real artifact is persisted: the Send button emails
 * the questions → `screening_sent`; the candidate responds → `screening_completed`;
 * the candidate books → `interview_scheduled`.
 *
 * Routing decisions a recruiter SHOULD own are unaffected: reject, mark
 * `screening_expired` / `interview_no_show`, approve into screening, advance a
 * scored candidate to `interview_invited`, etc. — none assert a machine artifact.
 *
 * `interview_invited` stays settable even though the AI interview now ships a
 * real invite artifact (token link + deadline). It is the HITL advancement
 * point — a `screening_scored` candidate has no other way forward — and the
 * manual advance is not a fabrication: transitioning into the state is exactly
 * what mints the token link and sends the invite
 * (`sendTransitionNotification`), the same way the Send button produces
 * `screening_sent`. The evidence-bearing states behind it
 * (`interview_completed` / `interview_scored`) remain system-only.
 */
export const SYSTEM_PRODUCED_STATES: readonly ApplicationState[] = [
  "screening_sent",
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
