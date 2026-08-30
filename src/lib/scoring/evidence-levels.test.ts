import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LEVEL_SCORE,
  EvidenceLevelSchema,
  scoreEvidenceLevel,
  type EvidenceLevel,
} from "./evidence-levels";

/**
 * The seam where the AI stops and the machine starts.
 *
 * Every number in the product comes from this table: a resume ranking, a
 * screening overall, an interview overall. Editing a value here silently
 * re-grades all three stages at once, and the stage rules versions are what
 * make that traceable — so the table is pinned literally rather than derived,
 * because a test that recomputed it from the source would agree with any edit.
 */

describe("EVIDENCE_LEVEL_SCORE", () => {
  it("is the published ladder, exactly", () => {
    expect(EVIDENCE_LEVEL_SCORE).toEqual({
      not_present: 0,
      unclear: 0,
      weak: 25,
      partial: 55,
      strong: 80,
      very_strong: 100,
    });
  });

  it("scores every level the schema accepts", () => {
    for (const level of EvidenceLevelSchema.options) {
      expect(typeof scoreEvidenceLevel(level)).toBe("number");
    }
  });

  it("never scores a stronger reading lower than a weaker one", () => {
    const ascending: EvidenceLevel[] = [
      "unclear",
      "weak",
      "partial",
      "strong",
      "very_strong",
    ];

    for (let i = 1; i < ascending.length; i++) {
      expect(scoreEvidenceLevel(ascending[i])).toBeGreaterThan(
        scoreEvidenceLevel(ascending[i - 1]),
      );
    }
  });

  /** "We could not tell" is not partial credit. */
  it("scores `unclear` at zero, alongside `not_present`", () => {
    expect(scoreEvidenceLevel("unclear")).toBe(0);
    expect(scoreEvidenceLevel("unclear")).toBe(scoreEvidenceLevel("not_present"));
  });

  /**
   * `MUST_HAVE_MINIMUM_SCORE` is 60, and the gate is only meaningful because it
   * falls between these two rungs: a must-have needs concrete professional or
   * project evidence, so `partial` must fail it and `strong` must pass.
   */
  it("puts the resume must-have line between `partial` and `strong`", () => {
    expect(scoreEvidenceLevel("partial")).toBeLessThan(60);
    expect(scoreEvidenceLevel("strong")).toBeGreaterThanOrEqual(60);
  });

  it("caps a perfect reading at 100, so a flawless rubric scores 100", () => {
    expect(scoreEvidenceLevel("very_strong")).toBe(100);
  });
});
