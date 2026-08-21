import { z } from "zod/v4";

/**
 * How much proof of something a piece of candidate evidence actually contains.
 *
 * This is the whole of what a model is allowed to say about any stage. It never
 * scores, never weighs, never ranks and never recommends — it reads a document
 * or a transcript and reports what it found, in a vocabulary with fixed
 * meanings. Every number downstream comes from this label via the table below,
 * which is what makes two runs over the same evidence produce the same result:
 * the model would have to change its *reading* to change the outcome, not
 * merely its arithmetic.
 *
 * The vocabulary lives here, above both `resume-scoring` and
 * `screening-scoring`, because the two stages must grade on the same ladder.
 * If a `strong` reading of a CV and a `strong` reading of a spoken answer ever
 * scored differently, "strong" would stop meaning anything and a recruiter
 * comparing two stage scores would be comparing two different rulers.
 *
 * What each level *means* is stage-specific and lives with that stage — a CV
 * proves a skill differently than an answer proves it.
 */
export const EvidenceLevelSchema = z.enum([
  "not_present",
  "unclear",
  "weak",
  "partial",
  "strong",
  "very_strong",
]);

export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

/**
 * Evidence level → score. A lookup table, not a judgement.
 *
 * This is the seam where the AI stops and the machine starts. The model chose a
 * label; every number after this point is a consequence of that label and
 * nothing else. Changing these numbers changes hiring decisions, so each stage
 * versions its own rules constant and any edit invalidates cached results
 * rather than silently re-grading history.
 *
 * `unclear` scores 0 alongside `not_present` on purpose: "we could not tell" is
 * not partial credit.
 */
export const EVIDENCE_LEVEL_SCORE = {
  not_present: 0,
  unclear: 0,
  weak: 25,
  partial: 55,
  strong: 80,
  very_strong: 100,
} as const;

export function scoreEvidenceLevel(level: EvidenceLevel): number {
  return EVIDENCE_LEVEL_SCORE[level];
}
