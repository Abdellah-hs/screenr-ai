import { describe, expect, it } from "vitest";
import { normalizeWeights, weightedMean } from "./weights";

/**
 * The arithmetic behind every overall score in the product — the resume
 * ranking's siblings at both spoken stages read it, and the interview reads it
 * twice (once over the whole rubric, once over the dimensions the conversation
 * actually reached).
 *
 * It was exercised only through the stage packages, which is exactly the shape
 * of coverage that lets a shared helper drift: a change made for one stage
 * passes that stage's suite and silently re-grades the other two. These test
 * the contract itself.
 */

describe("normalizeWeights", () => {
  it("returns nothing for an empty rubric", () => {
    expect(normalizeWeights([])).toEqual([]);
  });

  it("gives a single dimension the whole score", () => {
    expect(normalizeWeights([{ weight: 0.4 }])).toEqual([1]);
  });

  /**
   * The case this function exists for. Weights are rounded to 2dp on save, so
   * three equal dimensions store 0.33 each and sum to 0.99. Trusting that sum
   * would cap a flawless call at 99 — a candidate who could not have done
   * better told they fell a point short.
   */
  it("rescales weights that round to less than 1", () => {
    const shares = normalizeWeights([{ weight: 0.33 }, { weight: 0.33 }, { weight: 0.33 }]);

    expect(shares.reduce((sum, s) => sum + s, 0)).toBeCloseTo(1, 10);
  });

  it("rescales weights that sum to more than 1", () => {
    const shares = normalizeWeights([{ weight: 0.7 }, { weight: 0.7 }]);

    expect(shares.reduce((sum, s) => sum + s, 0)).toBeCloseTo(1, 10);
  });

  /**
   * The interview re-normalises across the dimensions it actually reached, so
   * it hands this a subset whose weights sum to well under 1. Dropping half the
   * rubric must remove those dimensions from the question, not halve the score
   * of the ones that remain.
   */
  it("rescales a subset so the survivors carry the whole score", () => {
    const shares = normalizeWeights([{ weight: 0.2 }, { weight: 0.2 }]);

    expect(shares).toEqual([0.5, 0.5]);
  });

  it("keeps the proportion between unequal weights", () => {
    const shares = normalizeWeights([{ weight: 0.6 }, { weight: 0.2 }, { weight: 0.2 }]);

    expect(shares[0]).toBeCloseTo(0.6, 10);
    expect(shares[0] / shares[1]).toBeCloseTo(3, 10);
  });

  /**
   * A legacy rubric with no weights at all. Dividing by zero here would score
   * every candidate 0, which reads as "they all failed" rather than as "this
   * rubric was never weighted" — a silent, total misreading of everyone on the
   * campaign.
   */
  it("falls back to equal shares when every weight is zero", () => {
    expect(normalizeWeights([{ weight: 0 }, { weight: 0 }, { weight: 0 }])).toEqual([
      1 / 3,
      1 / 3,
      1 / 3,
    ]);
  });

  /** Same reasoning: a negative weight must not drag the total toward zero. */
  it("clamps a negative weight to zero rather than subtracting it", () => {
    const shares = normalizeWeights([{ weight: 1 }, { weight: -1 }]);

    expect(shares).toEqual([1, 0]);
  });

  it("falls back to equal shares when the weights cancel to zero", () => {
    expect(normalizeWeights([{ weight: -1 }, { weight: -2 }])).toEqual([0.5, 0.5]);
  });
});

describe("weightedMean", () => {
  it("scores an empty rubric 0 rather than throwing", () => {
    expect(weightedMean([])).toBe(0);
  });

  it("weights each dimension by its share", () => {
    expect(
      weightedMean([
        { score: 100, weight: 0.6 },
        { score: 80, weight: 0.4 },
      ]),
    ).toBe(92);
  });

  it("rounds to a whole number", () => {
    expect(weightedMean([{ score: 55, weight: 0.5 }, { score: 80, weight: 0.5 }])).toBe(68);
  });

  it("scores an all-zero rubric 0", () => {
    expect(weightedMean([{ score: 0, weight: 1 }])).toBe(0);
  });

  /**
   * The two functions together, on the rubric that motivated the rescaling: a
   * candidate who was read `very_strong` on every dimension of a three-part
   * rubric must reach 100, not 99.
   */
  it("lets a flawless run reach 100 on a rubric whose weights round to 0.99", () => {
    const dimensions = [{ weight: 0.33 }, { weight: 0.33 }, { weight: 0.33 }];
    const shares = normalizeWeights(dimensions);

    expect(weightedMean(shares.map((weight) => ({ score: 100, weight })))).toBe(100);
  });
});
