import { describe, expect, it } from "vitest";

import { firstLevelClearing } from "@/lib/candidates/resume-score-copy";
import { MUST_HAVE_MINIMUM_SCORE } from "@/lib/resume-scoring";

describe("firstLevelClearing", () => {
  it("names strong as the cheapest level that clears the must-have gate", () => {
    // partial (55) falls short of 60; strong (80) is the first that does not.
    expect(firstLevelClearing(MUST_HAVE_MINIMUM_SCORE)).toBe("strong");
  });

  it("walks down the ladder when the bar is lower", () => {
    expect(firstLevelClearing(55)).toBe("partial");
    expect(firstLevelClearing(25)).toBe("weak");
    expect(firstLevelClearing(81)).toBe("very_strong");
  });

  it("treats a bar of zero as cleared by the bottom of the ladder", () => {
    expect(firstLevelClearing(0)).toBe("not_present");
  });

  it("returns null when no level could ever clear the bar", () => {
    expect(firstLevelClearing(101)).toBeNull();
  });
});
