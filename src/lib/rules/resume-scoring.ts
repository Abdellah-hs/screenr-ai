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
 * The mandatory-criteria knockout gate. Cross-references each `is_mandatory`
 * resume-rubric dimension against its paired factor score (factors are index-
 * aligned to dimensions per the scoring-prompt contract) and returns the
 * labels of every mandatory dimension scoring below its own `min_score` —
 * the per-dimension "fail line" the recruiter set in the rubric editor.
 *
 * A dimension with no paired factor (malformed AI output: fewer factors than
 * dimensions) is skipped rather than treated as a failure — we don't reject a
 * candidate on missing evidence. The overall-threshold check still applies.
 */
function failedMandatoryCriteria(
  result: ResumeScoreResult,
  config: CampaignScoringConfig,
): string[] {
  return config.screening_criteria
    .filter((criterion, i) => {
      if (!criterion.is_mandatory) return false;
      const factor = result.factors[i];
      return factor !== undefined && factor.score < criterion.min_score;
    })
    .map((criterion) => criterion.label);
}

/**
 * Rule layer — reads persisted resume-score evidence and decides the next
 * transition. Pure function: never calls the AI, never touches the DB.
 *
 * The mandatory-criteria knockout gate runs FIRST, ahead of both the HITL and
 * threshold branches: a candidate who fails any Required criterion is a hard
 * fail in every mode — a high weighted overall must not mask a non-negotiable
 * miss. This is the rule branch that makes "Required" actually enforce
 * something instead of just shaping the AI narrative (CLAUDE.md: Control > AI).
 *
 * Behaviour:
 *   - fail mandatory gate (any mode) → `rejected` (disposition LOW_SCORE).
 *   - human_in_loop: any score        → `screening_review_pending` so a
 *                    recruiter reviews before the application advances.
 *   - fully_auto:    pass threshold → `screening_approved`; else → `rejected`.
 */
export function evaluateResumeScoringOutcome(
  result: ResumeScoreResult,
  config: CampaignScoringConfig,
): TransitionDescriptor {
  const scoreLine = `Resume score ${result.overall_score} vs threshold ${config.screening_threshold}`;

  const failedRequired = failedMandatoryCriteria(result, config);
  if (failedRequired.length > 0) {
    const failedList = failedRequired.join(", ");
    return {
      toState: "rejected",
      rationale: `${scoreLine} — failed required criteria below their min_score: ${failedList} [LOW_SCORE]`,
    };
  }

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
