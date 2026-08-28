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
 * v1 is the first version in which the interview is scored at all rather than
 * rated. Everything before it carries no rules version, because there were no
 * rules: the model returned 0-100 per competency and the code averaged them.
 * The two are not comparable and history is not back-filled — re-score to move
 * a candidate onto the current rules.
 */
export const INTERVIEW_SCORING_RULES_VERSION = "v1_weighted_dimensions";

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
  overall_score: number;
  dimensions: ScoredInterviewDimension[];
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
 * This replaced a scorer that asked the model for 0-100 per competency and
 * averaged them. Two things were wrong with that and both are fixed here:
 * "is this a 68 or a 74" has no stable answer, so the same interview could
 * score differently on consecutive runs; and the model chose the competencies
 * itself, so the recruiter's interview rubric was never read at all.
 *
 * The overall is the **weighted** mean over every rubric dimension, covered or
 * not. A competency the interview never reached scores 0 and is still counted:
 * dropping it from the denominator would mean a candidate who evidenced one
 * competency well and never touched the other four outscored one who covered
 * all five adequately. Weighting is what makes that fair rather than merely
 * strict — a low-importance dimension left uncovered costs less than a
 * high-importance one.
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

  return {
    overall_score: weightedMean(scored),
    dimensions: scored,
    validation_warnings: validated.warnings,
  };
}
