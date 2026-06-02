import {
  IMPORTANCE_POINTS,
  MANDATORY_FAIL_LINE,
  type DimensionImportance,
} from "@/lib/constants";

/**
 * The two decisions a recruiter actually makes about a rubric dimension.
 * Everything else (weight, fail line, scale) is derived from these — the
 * recruiter never sees a raw number (issue #77).
 */
export interface DimensionIntent {
  importance: DimensionImportance;
  is_mandatory: boolean;
}

export interface DerivedDimensionFields {
  weight: number;
  min_score: number;
  max_score: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Translate recruiter intent (importance + Must-Have) into the numeric fields
 * the scoring service and knockout gate consume:
 *
 *   - `weight`    — importance points (High=3/Med=2/Low=1) normalized across
 *                   the rubric so the set sums to ~1.
 *   - `min_score` — the knockout fail line: `MANDATORY_FAIL_LINE` for a
 *                   Must-Have dimension, 0 otherwise.
 *   - `max_score` — always 100.
 *
 * Pure: this is the single place intent becomes numbers, called on save so the
 * downstream scoring/rule layers stay unchanged. Weight normalization is
 * relative to the dimensions passed in, so always derive over a whole rubric.
 */
export function deriveDimensionFields<T extends DimensionIntent>(
  dimensions: T[],
): (T & DerivedDimensionFields)[] {
  const totalPoints = dimensions.reduce(
    (sum, d) => sum + IMPORTANCE_POINTS[d.importance],
    0,
  );

  return dimensions.map((d) => ({
    ...d,
    weight: totalPoints === 0 ? 0 : round2(IMPORTANCE_POINTS[d.importance] / totalPoints),
    min_score: d.is_mandatory ? MANDATORY_FAIL_LINE : 0,
    max_score: 100,
  }));
}
