import {
  scoreEvidenceLevel,
  type EvidenceLevel,
} from "@/lib/scoring/evidence-levels";
import type { ScreeningEvidenceItem } from "./evidence";
import type { ValidatedScreeningEvidence } from "./validate";

/**
 * Version of the deterministic rules below. Recorded in the audit log so a
 * stored score always says which arithmetic produced it.
 */
export const SCREENING_SCORING_RULES_VERSION = "v1_evidence_levels";

export interface ScoredScreeningAnswer {
  question_id: string;
  evidence_level: EvidenceLevel;
  /** What the model claimed, kept so a downgrade is visible in the audit trail. */
  reported_evidence_level: EvidenceLevel;
  score: number;
  evidence_items: ScreeningEvidenceItem[];
  notes: string | null;
}

export interface DeterministicScreeningScoreResult {
  overall_score: number;
  answers: ScoredScreeningAnswer[];
  validation_warnings: string[];
}

/**
 * Turn validated evidence into scores.
 *
 * Every number in the result is a consequence of a level the model chose and
 * of nothing else — there is no place here for the model to express a number,
 * which is the entire point. Two runs that read the transcript the same way
 * score it the same way.
 *
 * The overall is the arithmetic mean of every question, answered or not. A
 * question the candidate never reached scores 0 and is *counted*: dropping it
 * from the denominator would mean a candidate who answered one question well
 * and skipped four outscored one who answered all five adequately.
 */
export function calculateScreeningScore(
  validated: ValidatedScreeningEvidence,
): DeterministicScreeningScoreResult {
  const answers: ScoredScreeningAnswer[] = validated.answers.map((a) => ({
    question_id: a.question_id,
    evidence_level: a.evidence_level,
    reported_evidence_level: a.reported_evidence_level,
    score: scoreEvidenceLevel(a.evidence_level),
    evidence_items: a.evidence_items,
    notes: a.notes,
  }));

  return {
    overall_score: averageScore(answers),
    answers,
    validation_warnings: validated.warnings,
  };
}

/**
 * Mean of the per-question scores, rounded.
 *
 * Zero questions scores 0 rather than throwing: a campaign with no screening
 * questions cannot produce a screening response in the first place, so this is
 * a total for a case the pipeline already prevents, not a silent default.
 */
function averageScore(answers: ScoredScreeningAnswer[]): number {
  if (answers.length === 0) return 0;
  const total = answers.reduce((sum, a) => sum + a.score, 0);
  return Math.round(total / answers.length);
}
