import { describe, expect, it } from "vitest";
import {
  coverageBlockers,
  coverageSignature,
  coverageWithoutQuestions,
  reconcileCoverage,
  type CoverageDimension,
} from "./coverage";

const DIMENSIONS: CoverageDimension[] = [
  { id: "d1", name: "Scaling experience" },
  { id: "d2", name: "Debugging method" },
  { id: "d3", name: "Team communication" },
];

describe("reconcileCoverage", () => {
  it("reports the gap the model found", () => {
    const result = reconcileCoverage(
      [{ dimension_id: "d3", reason: "Nothing asks about working with others." }],
      DIMENSIONS,
    );

    expect(result.uncoveredDimensions).toEqual([
      {
        dimensionId: "d3",
        dimensionName: "Team communication",
        reason: "Nothing asks about working with others.",
      },
    ]);
  });

  /**
   * A warning naming something the recruiter cannot find in their own rubric is
   * a warning they cannot act on — and it teaches them to ignore the next one.
   */
  it("drops a dimension id that is not in the rubric", () => {
    const result = reconcileCoverage(
      [{ dimension_id: "invented", reason: "Made up." }],
      DIMENSIONS,
    );

    expect(result.uncoveredDimensions).toEqual([]);
  });

  /**
   * Silence is not evidence of a gap. The check is deliberately conservative:
   * it catches the obvious hole, it does not police interview technique.
   */
  it("treats a dimension the model never mentioned as covered", () => {
    const result = reconcileCoverage([], DIMENSIONS);

    expect(result.uncoveredDimensions).toEqual([]);
  });

  it("uses the recruiter's own wording, not the model's", () => {
    const result = reconcileCoverage(
      [{ dimension_id: "d1", reason: "No scaling question." }],
      DIMENSIONS,
    );

    expect(result.uncoveredDimensions[0].dimensionName).toBe("Scaling experience");
  });

  it("counts a dimension listed twice as one gap", () => {
    const result = reconcileCoverage(
      [
        { dimension_id: "d2", reason: "First mention." },
        { dimension_id: "d2", reason: "Second mention." },
      ],
      DIMENSIONS,
    );

    expect(result.uncoveredDimensions).toHaveLength(1);
    expect(result.uncoveredDimensions[0].reason).toBe("First mention.");
  });

  it("lists gaps in rubric order, not the order the model answered in", () => {
    const result = reconcileCoverage(
      [
        { dimension_id: "d3", reason: "c" },
        { dimension_id: "d1", reason: "a" },
      ],
      DIMENSIONS,
    );

    expect(result.uncoveredDimensions.map((d) => d.dimensionId)).toEqual(["d1", "d3"]);
  });

  /**
   * A question that maps to no rubric dimension is legitimate — "why do you
   * want to work here" is a fine thing to ask. Coverage is only ever about
   * dimensions with no question, never about questions with no dimension.
   */
  it("has no way to report a question as unmatched", () => {
    const result = reconcileCoverage([], DIMENSIONS);

    expect(Object.keys(result)).toEqual(["uncoveredDimensions"]);
  });
});

describe("coverageWithoutQuestions", () => {
  it("flags every dimension when there is nothing to ask", () => {
    const result = coverageWithoutQuestions(DIMENSIONS);

    expect(result.uncoveredDimensions.map((d) => d.dimensionId)).toEqual(["d1", "d2", "d3"]);
  });

  it("flags nothing when the rubric is empty too", () => {
    expect(coverageWithoutQuestions([]).uncoveredDimensions).toEqual([]);
  });
});

describe("coverageSignature", () => {
  it("changes when a dimension is renamed", () => {
    const before = coverageSignature(DIMENSIONS, [{ prompt: "Tell me about scaling." }]);
    const after = coverageSignature(
      [{ id: "d1", name: "Distributed systems" }, DIMENSIONS[1], DIMENSIONS[2]],
      [{ prompt: "Tell me about scaling." }],
    );

    expect(after).not.toBe(before);
  });

  it("changes when a question is reworded", () => {
    const before = coverageSignature(DIMENSIONS, [{ prompt: "Tell me about scaling." }]);
    const after = coverageSignature(DIMENSIONS, [{ prompt: "Describe a scaling problem." }]);

    expect(after).not.toBe(before);
  });

  it("changes when a question is removed", () => {
    const before = coverageSignature(DIMENSIONS, [{ prompt: "A" }, { prompt: "B" }]);
    const after = coverageSignature(DIMENSIONS, [{ prompt: "A" }]);

    expect(after).not.toBe(before);
  });

  /** Reordering changes nothing about what is asked, so it must not re-call. */
  it("does not change when questions are only reordered", () => {
    const before = coverageSignature(DIMENSIONS, [{ prompt: "A" }, { prompt: "B" }]);
    const after = coverageSignature(DIMENSIONS, [{ prompt: "B" }, { prompt: "A" }]);

    expect(after).toBe(before);
  });

  it("ignores a blank question the recruiter has not written yet", () => {
    const before = coverageSignature(DIMENSIONS, [{ prompt: "A" }]);
    const after = coverageSignature(DIMENSIONS, [{ prompt: "A" }, { prompt: "   " }]);

    expect(after).toBe(before);
  });
});

describe("coverageBlockers", () => {
  it("names the dimension and states what it costs", () => {
    const blockers = coverageBlockers({
      uncoveredDimensions: [
        { dimensionId: "d3", dimensionName: "Team communication", reason: "x" },
      ],
    });

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("Team communication");
    expect(blockers[0]).toContain("zero");
  });

  /**
   * This is a model's reading and it can be wrong, so the sentence must not
   * assert more than was established. "Appears" is doing real work.
   */
  it("hedges the claim rather than asserting it", () => {
    const blockers = coverageBlockers({
      uncoveredDimensions: [{ dimensionId: "d1", dimensionName: "Scaling", reason: "x" }],
    });

    expect(blockers[0]).toMatch(/appears/i);
  });

  /**
   * There is no "continue anyway" any more, so the sentence is the only thing
   * standing between the recruiter and a dead end. It has to say what to do.
   */
  it("names both ways out, because there is no override", () => {
    const blockers = coverageBlockers({
      uncoveredDimensions: [{ dimensionId: "d1", dimensionName: "Scaling", reason: "x" }],
    });

    expect(blockers[0]).toMatch(/add a question/i);
    expect(blockers[0]).toMatch(/remove it from the rubric/i);
  });

  it("says nothing when everything is covered", () => {
    expect(coverageBlockers({ uncoveredDimensions: [] })).toEqual([]);
  });
});
