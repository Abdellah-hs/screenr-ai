import type { ApplicationState, AutomationMode, Disposition } from "@/lib/constants";
import type {
  DeterministicResumeScoreResult,
  ResumeCriterion,
} from "@/lib/resume-scoring";

/**
 * The campaign evidence this rule decides on. Owned by the rule layer — the
 * decisioner declares what it needs and the data layer (`fetchCampaignScoringConfig`)
 * produces a conforming object. Declaring it here (rather than deriving it from
 * the data function's return type) keeps the dependency arrow pointing
 * rules → constants only, never rules → data.
 *
 * `screening_threshold` now applies to the **ranking** score, which only exists
 * for a candidate who already cleared every must-have. It is a bar on how good
 * an eligible candidate is, never a way to become eligible.
 */
export interface CampaignScoringConfig {
  id: string;
  description: string;
  automation_mode: AutomationMode;
  screening_threshold: number;
  screening_criteria: ResumeCriterion[];
}

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
  /**
   * Set whenever `toState` closes the application. The rule decides the code
   * because the rule is what knows *why* — the action executing the
   * transition sees only a target state, and would have to re-derive the
   * reason to label it.
   */
  disposition?: Disposition;
}

/**
 * Rule layer — reads the deterministic resume evaluation and decides the next
 * transition. Pure function: never calls the AI, never touches the DB.
 *
 * The must-have gate runs FIRST, ahead of both the HITL and threshold branches,
 * and it is not a threshold — it is a different kind of check. A candidate
 * missing a non-negotiable requirement is out in every automation mode, and no
 * ranking number can reach back and change that, because ineligible candidates
 * do not have one.
 *
 * Behaviour:
 *   - ineligible (any mode) → `rejected` (disposition LOW_SCORE).
 *   - human_in_loop        → `screening_review_pending` so a recruiter reviews
 *                            before the application advances.
 *   - fully_auto           → ranking ≥ threshold → `screening_approved`;
 *                            else → `rejected`.
 */
export function evaluateResumeScoringOutcome(
  result: DeterministicResumeScoreResult,
  config: CampaignScoringConfig,
): TransitionDescriptor {
  if (!result.eligible) {
    const failedList = result.failed_must_haves.map((f) => f.criterion_label).join(", ");
    return {
      toState: "rejected",
      rationale: `Ineligible — failed must-have criteria: ${failedList}`,
      disposition: {
        code: "LOW_SCORE",
        description: `Failed must-have criteria: ${failedList}`,
      },
    };
  }

  // Eligible always carries a ranking score by construction
  // (`calculateNiceToHaveRanking`); the fallback only keeps this total.
  const ranking = result.ranking_score ?? 0;
  const scoreLine = `Eligible — ranking score ${ranking} vs threshold ${config.screening_threshold}`;

  if (config.automation_mode === "human_in_loop") {
    return {
      toState: "screening_review_pending",
      rationale: `${scoreLine} — awaiting recruiter review (HITL mode)`,
    };
  }

  if (ranking >= config.screening_threshold) {
    return {
      toState: "screening_approved",
      rationale: `${scoreLine} — passed`,
    };
  }

  return {
    toState: "rejected",
    rationale: `${scoreLine} — below threshold`,
    disposition: {
      code: "LOW_SCORE",
      description: `Met every must-have but ranked ${ranking}, below the campaign threshold of ${config.screening_threshold}`,
    },
  };
}

/**
 * States where a resume re-score is not allowed: the application is closed.
 * Re-scoring exists to refresh evidence for live candidates (e.g. after the
 * rubric changed); rewriting the current score on a decided application would
 * only muddy its record.
 */
const RESCORE_BLOCKED_STATES: ApplicationState[] = ["hired", "rejected", "archived"];

/**
 * Guard for the recruiter-triggered resume re-score. Throws when the
 * application has reached a terminal state. Anywhere else in the pipeline is
 * fine — a re-score only produces fresh evidence (the audit log keeps every
 * run) and never transitions, so it can't disturb an in-flight application.
 */
export function assertResumeRescoreAllowed(status: ApplicationState): void {
  if (RESCORE_BLOCKED_STATES.includes(status)) {
    throw new Error(
      `This application is closed ("${status}") — re-scoring only applies to candidates still in the pipeline.`,
    );
  }
}
