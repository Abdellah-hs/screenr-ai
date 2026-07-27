import type { ApplicationState } from "@/lib/constants";

/**
 * A deferred state-machine transition. The rule returns these; the caller
 * executes them via `transitionApplication`. Mirrors the descriptors in the
 * sibling scoring rules — kept local so producers can't couple across decisions.
 */
export interface InterviewTransitionDescriptor {
  toState: ApplicationState;
  rationale: string;
}

/**
 * Rule layer — turns a persisted interview score into the transition(s) the
 * action should apply. Pure: no AI, no DB.
 *
 * The AI interview is a high-stakes, late-pipeline stage, so scoring is
 * **record-only**: it advances `interview_completed → interview_scored` and
 * stops there for a human to act on (reference check / manager review /
 * rejection). Unlike screening, it never auto-advances or auto-rejects — the
 * PRD wants managers inspecting stage-specific evidence, not a rollup gate.
 * (An automation-mode fast-path could be layered on later without changing
 * this contract.)
 */
export function evaluateInterviewScoringOutcome(result: {
  overall_score: number;
}): InterviewTransitionDescriptor[] {
  return [
    {
      toState: "interview_scored",
      rationale: `Interview score ${result.overall_score} — recorded for manager review`,
    },
  ];
}
