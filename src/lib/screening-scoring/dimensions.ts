/**
 * A screening rubric dimension, reduced to what scoring is allowed to see.
 *
 * The stored `rubric_dimensions` row carries more than this — `is_mandatory`,
 * `min_score`, `importance`, `sort_order`. Only `weight` crosses into the
 * scorer, and the omissions are the design:
 *
 * - **`is_mandatory` / `min_score` are deliberately absent.** There is no
 *   must-have gate on screening (CLAUDE.md, 2026-08-21): a resume must-have is
 *   objective and checkable against a document, while a screening answer is
 *   speech, transcribed, and noisier. A weak answer lowers the score; it never
 *   auto-rejects. Leaving the fields out of the type means the gate cannot be
 *   reintroduced by accident — there is nothing here to reach for.
 * - **`importance` is absent because `weight` already is it.** `weight` is
 *   derived from importance on save by `deriveDimensionFields`; reading both
 *   would be two sources for one decision.
 */
export interface ScreeningDimension {
  id: string;
  name: string;
  /** Normalised share of the overall score. A rubric's weights sum to ~1. */
  weight: number;
}

/**
 * Weight normalisation moved to `@/lib/scoring/weights` on 2026-08-28, when the
 * AI interview came onto the same pipeline. A rubric whose weights round to
 * 0.99 must behave identically at every stage that reads one.
 */
export { normalizeWeights } from "@/lib/scoring/weights";
