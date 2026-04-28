import type { ScoreFactor, ApplicationState } from "@/lib/constants";
import type { fetchCampaignScoringConfig } from "@/lib/data/campaigns";

/**
 * Shape of the AI's resume-scoring output. Defined here (not in the action
 * or service that produces it) because the rule layer owns the contract it
 * reads — that's what keeps AI advisory: the decisioner declares what
 * evidence it requires, producers conform.
 */
export interface ResumeScoreResult {
  overall_score: number;
  tier: "strong" | "moderate" | "weak" | "no_match";
  rationale: string;
  factors: ScoreFactor[];
}

export type CampaignScoringConfig = NonNullable<
  Awaited<ReturnType<typeof fetchCampaignScoringConfig>>
>;

/**
 * A deferred state-machine transition. The rule layer returns one of these;
 * the caller is responsible for executing it (via advanceApplicationStatus /
 * transitionApplication). Keeping the rule pure — no I/O, no side effects —
 * makes it trivial to test and impossible to accidentally promote AI output
 * to "source of truth".
 */
export interface TransitionDescriptor {
  toState: ApplicationState;
  rationale: string;
}

/**
 * Rule layer — reads persisted resume-score evidence and decides the next
 * transition. Pure function: never calls the AI, never touches the DB.
 *
 * Behaviour:
 *   - fully_auto:    pass threshold → `screening_approved`; else → `rejected`.
 *   - human_in_loop: any score        → `screening_review_pending` so a
 *                    recruiter reviews before the application advances.
 */
export function evaluateResumeScoringOutcome(
  result: ResumeScoreResult,
  config: CampaignScoringConfig,
): TransitionDescriptor {
  const scoreLine = `Resume score ${result.overall_score} vs threshold ${config.screening_threshold}`;

  if (config.automation_mode === "human_in_loop") {
    return {
      toState: "screening_review_pending",
      rationale: `${scoreLine} — awaiting recruiter review (HITL mode)`,
    };
  }

  if (result.overall_score >= config.screening_threshold) {
    return {
      toState: "screening_approved",
      rationale: `${scoreLine} — passed`,
    };
  }

  return {
    toState: "rejected",
    rationale: `${scoreLine} — below threshold`,
  };
}
