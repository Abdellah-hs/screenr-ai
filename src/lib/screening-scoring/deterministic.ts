import {
  scoreEvidenceLevel,
  type EvidenceLevel,
} from "@/lib/scoring/evidence-levels";
import { normalizeWeights, weightedMean } from "@/lib/scoring/weights";
import type { ScreeningDimension } from "./dimensions";
import type { ScreeningEvidenceItem } from "./evidence";
import type { ValidatedScreeningEvidence } from "./validate";

/**
 * Version of the deterministic rules below. Recorded in the audit log so a
 * stored score always says which arithmetic produced it.
 *
 * v2: scoring moved from an unweighted mean over questions to a weighted mean
 * over rubric dimensions. Bumped rather than edited in place because the same
 * transcript scores differently under the two, and a stored score has to say
 * which one it came from.
 */
export const SCREENING_SCORING_RULES_VERSION = "v2_weighted_dimensions";

export interface ScoredScreeningDimension {
  dimension_id: string;
  name: string;
  /** The share of the overall this dimension actually carried, after normalising. */
  weight: number;
  evidence_level: EvidenceLevel;
  /** What the model claimed, kept so a downgrade is visible in the audit trail. */
  reported_evidence_level: EvidenceLevel;
  score: number;
  evidence_items: ScreeningEvidenceItem[];
  notes: string | null;
}

export interface DeterministicScreeningScoreResult {
  overall_score: number;
  dimensions: ScoredScreeningDimension[];
  validation_warnings: string[];
}

/**
 * Turn validated evidence into scores.
 *
 * Every number in the result is a consequence of a level the model chose and of
 * a weight the recruiter's rubric set — there is no place here for the model to
 * express a number, which is the entire point. Two runs that read the transcript
 * the same way score it the same way.
 *
 * The overall is the **weighted** mean over every rubric dimension, covered or
 * not. A dimension the call never got to scores 0 and is still counted: dropping
 * it from the denominator would mean a candidate who evidenced one competency
 * well and never touched the other four outscored one who covered all five
 * adequately. Weighting is what makes that fair rather than merely strict — a
 * low-importance dimension left uncovered costs less than a high-importance one.
 *
 * `dimensions` and `validated.dimensions` are index-aligned; `validateScreeningEvidence`
 * has already proved they match in length and order, which is why this is a zip.
 */
export function calculateScreeningScore(
  validated: ValidatedScreeningEvidence,
  dimensions: ScreeningDimension[],
): DeterministicScreeningScoreResult {
  if (validated.dimensions.length !== dimensions.length) {
    throw new Error(
      `Cannot score: ${dimensions.length} rubric dimension(s) but ${validated.dimensions.length} validated finding(s).`,
    );
  }

  const weights = normalizeWeights(dimensions);

  const scored: ScoredScreeningDimension[] = dimensions.map((dimension, i) => {
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

  return {
    overall_score: weightedMean(scored),
    dimensions: scored,
    validation_warnings: validated.warnings,
  };
}
