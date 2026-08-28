import { describe, it, expect } from "vitest";
import { normalizeWeights } from "./dimensions";

describe("normalizeWeights", () => {
  it("leaves a well-formed rubric's weights alone", () => {
    const dims = [
      { id: "a", name: "A", weight: 0.5 },
      { id: "b", name: "B", weight: 0.5 },
    ];

    expect(normalizeWeights(dims)).toEqual([0.5, 0.5]);
  });

  /**
   * Weights are rounded to 2dp on save, so three equal dimensions store 0.33
   * and sum to 0.99. Trusting that sum would cap a flawless candidate at 99.
   */
  it("rescales weights that do not quite sum to 1", () => {
    const dims = [
      { id: "a", name: "A", weight: 0.33 },
      { id: "b", name: "B", weight: 0.33 },
      { id: "c", name: "C", weight: 0.33 },
    ];

    const result = normalizeWeights(dims);

    expect(result.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 10);
  });

  it("falls back to equal shares when nothing is weighted", () => {
    const dims = [
      { id: "a", name: "A", weight: 0 },
      { id: "b", name: "B", weight: 0 },
    ];

    // Dividing by zero would score every candidate 0, which reads as "everyone
    // failed" rather than "this rubric was never weighted".
    expect(normalizeWeights(dims)).toEqual([0.5, 0.5]);
  });

  it("ignores a negative weight rather than letting it cancel another", () => {
    const dims = [
      { id: "a", name: "A", weight: -1 },
      { id: "b", name: "B", weight: 1 },
    ];

    expect(normalizeWeights(dims)).toEqual([0, 1]);
  });

  it("returns nothing for an empty rubric", () => {
    expect(normalizeWeights([])).toEqual([]);
  });
});
