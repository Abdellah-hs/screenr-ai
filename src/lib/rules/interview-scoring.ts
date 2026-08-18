import type { ApplicationState, AutomationMode } from "@/lib/constants";

/**
 * A deferred state-machine transition. The rule returns these; the caller
 * executes them via `transitionApplication`. Mirrors the descriptors in the
 * sibling scoring rules — kept local so producers can't couple across decisions.
 */
export interface InterviewTransitionDescriptor {
  toState: ApplicationState;
  rationale: string;
}

export interface InterviewScoringConfig {
  automation_mode: AutomationMode;
}

/**
 * Rule layer — turns a persisted interview score into the transition(s) the
 * action should apply. Pure: no AI, no DB.
 *
 * Always passes through `interview_scored` first, so the audit log records the
 * scoring event before any advancement. What happens next follows the campaign's
 * `automation_mode`, mirroring `evaluateScreeningScoringOutcome`:
 *
 *   - human_in_loop: [interview_scored]
 *   - fully_auto:    [interview_scored, manager_review]
 *
 * **The score is deliberately not a gate.** `fully_auto` advances every scored
 * interview to `manager_review` regardless of the number — it never auto-rejects
 * and never applies a threshold.
 *
 * Two reasons. First, `manager_review` is not an outcome, it is the handoff
 * point where a human takes over; advancing into it is exactly what "the AI took
 * this as far as it can without a person" means, so it is safe in a way that
 * auto-rejecting after a full interview would not be. Second, the PRD wants
 * managers inspecting stage-specific evidence rather than a rollup gate, and
 * rejecting a candidate who sat a whole interview on a single number is the
 * decision most worth keeping human.
 *
 * Previously this returned `interview_scored` unconditionally, so nothing in the
 * codebase ever moved an application INTO `manager_review` — every earlier stage
 * auto-advanced on a rule, and this one silently stopped. That looked accidental
 * rather than chosen; a `fully_auto` campaign parking scored interviews forever
 * contradicts the mode the recruiter explicitly selected.
 */
export function evaluateInterviewScoringOutcome(
  result: { overall_score: number },
  config: InterviewScoringConfig = { automation_mode: "human_in_loop" },
): InterviewTransitionDescriptor[] {
  const recordScored: InterviewTransitionDescriptor = {
    toState: "interview_scored",
    rationale: `Interview score ${result.overall_score} — recorded for manager review`,
  };

  if (config.automation_mode === "human_in_loop") {
    return [recordScored];
  }

  return [
    recordScored,
    {
      toState: "manager_review",
      rationale: `Interview score ${result.overall_score} — automatic pipeline, queued for the hiring manager's decision`,
    },
  ];
}
