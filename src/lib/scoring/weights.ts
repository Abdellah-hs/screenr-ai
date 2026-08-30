/**
 * Turning a recruiter's rubric weights into the shares a scorer applies.
 *
 * Shared by every stage that grades against a weighted rubric, so a rubric
 * whose weights are imperfect behaves identically wherever it is read.
 */

/** The only field weighting needs. Stages carry more; none of it belongs here. */
export interface WeightedDimension {
  /** Normalised share of the overall score. A rubric's weights sum to ~1. */
  weight: number;
}

/**
 * Weights as the scorer will actually apply them.
 *
 * `deriveDimensionFields` normalises weights on save, so a well-formed rubric
 * arrives summing to ~1 and this is a no-op. It exists for the rubrics that are
 * not well-formed, and there are two such cases that must not silently produce
 * a wrong number:
 *
 * - **Weights that do not sum to 1** — rounded to 2dp on save, so five equal
 *   dimensions store 0.2 each but three store 0.33 and sum to 0.99. Dividing by
 *   the real total rather than trusting 1 keeps a perfect run at 100 instead of
 *   99.
 * - **Every weight zero** (or a legacy rubric with no weights at all) — falls
 *   back to equal shares. The alternative is dividing by zero and scoring
 *   everyone 0, which would read as "every candidate failed" rather than as
 *   "this rubric was never weighted".
 */
export function normalizeWeights(dimensions: WeightedDimension[]): number[] {
  if (dimensions.length === 0) return [];

  const total = dimensions.reduce((sum, d) => sum + Math.max(0, d.weight), 0);
  if (total <= 0) return dimensions.map(() => 1 / dimensions.length);

  return dimensions.map((d) => Math.max(0, d.weight) / total);
}

/**
 * Weighted mean of already-scored dimensions, rounded.
 *
 * Zero dimensions scores 0 rather than throwing: the caller is responsible for
 * not scoring against an empty rubric, and a total for a case the pipeline
 * already prevents is better than a crash in the scoring path.
 */
export function weightedMean(
  dimensions: { score: number; weight: number }[],
): number {
  if (dimensions.length === 0) return 0;
  return Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
}
