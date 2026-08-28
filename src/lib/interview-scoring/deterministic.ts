import { scoreEvidenceLevel, type EvidenceLevel } from "@/lib/scoring/evidence-levels";
import { normalizeWeights, weightedMean } from "@/lib/scoring/weights";
import type {
  EvidenceItem,
  ValidatedTranscriptEvidence,
} from "@/lib/scoring/transcript-evidence";
import type { InterviewRubricDimension } from "./dimensions";

/**
 * Version of the deterministic rules below. Recorded in the audit log so a
 * stored score always says which arithmetic produced it.
 *
 * v1 was the first version in which the interview was scored rather than rated.
 * Everything before it carries no rules version, because there were no rules:
 * the model returned 0-100 per competency and the code averaged them.
 *
 * v2 scores only the dimensions the interview actually reached. None of these
 * are comparable and history is not back-filled — re-score to move a candidate
 * onto the current rules.
 */
export const INTERVIEW_SCORING_RULES_VERSION = "v2_covered_dimensions_only";

export interface ScoredInterviewDimension {
  dimension_id: string;
  name: string;
  /** The share of the overall this dimension actually carried, after normalising. */
  weight: number;
  evidence_level: EvidenceLevel;
  /** What the model claimed, kept so a downgrade is visible in the audit trail. */
  reported_evidence_level: EvidenceLevel;
  score: number;
  evidence_items: EvidenceItem[];
  notes: string | null;
}

export interface DeterministicInterviewScoreResult {
  /** The weighted mean over the ASSESSED dimensions only. */
  overall_score: number;
  /** Every rubric dimension, assessed or not — the breakdown shows them all. */
  dimensions: ScoredInterviewDimension[];
  /** How many dimensions the interview actually reached. */
  covered_count: number;
  /**
   * The share of the rubric's weight that was assessed, 0-1.
   *
   * Travels with the score and is rendered beside it, because without it the
   * number is uninterpretable: 100 from one dimension out of five and 80 from
   * all five are very different readings that would otherwise look like one
   * good score and one slightly worse one.
   */
  covered_weight: number;
  validation_warnings: string[];
}

/**
 * Whether the interview produced anything at all on this dimension.
 *
 * `not_present` is the ONLY excluded level, and the line is drawn there
 * deliberately. `unclear` means the candidate did talk about it and what they
 * said established nothing — that is a reading of an answer, so it is assessed
 * and scores 0. `not_present` means the conversation never went near the topic,
 * which is a fact about the interview rather than about the candidate.
 *
 * A quote that fails verification is downgraded to `unclear`, never to
 * `not_present`, so the validator can only ever move a dimension toward being
 * counted — it cannot drop one out of the denominator and raise the score.
 */
function wasAssessed(dimension: ScoredInterviewDimension): boolean {
  return dimension.evidence_level !== "not_present";
}

/**
 * Turn validated evidence into scores.
 *
 * Every number in the result is a consequence of a level the model chose and of
 * a weight the recruiter's rubric set — there is no place here for the model to
 * express a number, which is the entire point. Two runs that read the transcript
 * the same way score it the same way.
 *
 * This replaced a scorer that asked the model for 0-100 per competency and
 * averaged them. Two things were wrong with that and both are fixed here:
 * "is this a 68 or a 74" has no stable answer, so the same interview could
 * score differently on consecutive runs; and the model chose the competencies
 * itself, so the recruiter's interview rubric was never read at all.
 *
 * The overall is the **weighted** mean over the dimensions the interview
 * actually reached, re-normalised across them. A competency nobody asked about
 * is not scored at all.
 *
 * This is the one place the interview deliberately diverges from
 * `calculateScreeningScore`, which counts every dimension covered or not. The
 * difference is upstream: screening drafts its questions FROM the rubric and
 * checks coverage before the campaign goes live, so an unprobed dimension there
 * is a fixable authoring error and scoring it 0 is what exposes it. The
 * interview improvises from the candidate's CV by design — that is what makes
 * its evidence hard to bluff — so no mechanism aims a question at each
 * dimension and none should. Scoring an unreached dimension 0 would blame the
 * candidate for a question nobody put to them.
 *
 * What this gives up is real and is why `covered_weight` is not optional: a
 * candidate who evidenced one competency brilliantly and touched nothing else
 * now scores higher than one who covered everything adequately. The remedy is
 * disclosure rather than arithmetic — the coverage travels with the score and
 * is shown beside it, which works here precisely because the interview never
 * gates. Suppressing a thin score would be gate-like behaviour on the one stage
 * that has no gate.
 *
 * `dimensions` and `validated.dimensions` are index-aligned;
 * `validateTranscriptEvidence` has already proved they match in length and
 * order, which is why this is a zip.
 */
export function calculateInterviewScore(
  validated: ValidatedTranscriptEvidence,
  dimensions: InterviewRubricDimension[],
): DeterministicInterviewScoreResult {
  if (validated.dimensions.length !== dimensions.length) {
    throw new Error(
      `Cannot score: ${dimensions.length} rubric dimension(s) but ${validated.dimensions.length} validated finding(s).`,
    );
  }

  const weights = normalizeWeights(dimensions);

  const scored: ScoredInterviewDimension[] = dimensions.map((dimension, i) => {
    const evidence = validated.dimensions[i];
    return {
      dimension_id: dimension.id,
      name: dimension.name,
      weight: weights[i],
      evidence_level: evidence.evidence_level,
      reported_evidence_level: evidence.reported_evidence_level,
      score: scoreEvidenceLevel(evidence.evidence_level),
      evidence_items: evidence.evidence_items,
      notes: evidence.notes,
    };
  });

  const assessed = scored.filter(wasAssessed);
  // Re-normalised across the assessed dimensions only, so their shares sum to
  // 1 again — otherwise dropping half the rubric would halve every score rather
  // than removing it from the question.
  const assessedWeights = normalizeWeights(assessed);

  return {
    // Nothing assessed scores 0, which is honest: it is what a silent interview
    // produces, and the coverage beside it says the 0 is about the interview
    // rather than about the candidate.
    overall_score: weightedMean(
      assessed.map((d, i) => ({ score: d.score, weight: assessedWeights[i] })),
    ),
    dimensions: scored,
    covered_count: assessed.length,
    covered_weight: assessed.reduce((sum, d) => sum + d.weight, 0),
    validation_warnings: validated.warnings,
  };
}
