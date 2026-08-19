import { describe, it, expect } from "vitest";
import {
  CriterionPrioritySchema,
  MUST_HAVE_MINIMUM_SCORE,
  deriveResumeDimensionFields,
  importanceFromPriority,
  mandatoryFlagFromPriority,
  priorityFromMandatoryFlag,
} from "./criteria";

describe("CriterionPrioritySchema", () => {
  it("accepts only the two priorities a recruiter can choose", () => {
    expect(CriterionPrioritySchema.parse("must_have")).toBe("must_have");
    expect(CriterionPrioritySchema.parse("nice_to_have")).toBe("nice_to_have");
    expect(CriterionPrioritySchema.safeParse("high").success).toBe(false);
    expect(CriterionPrioritySchema.safeParse("required").success).toBe(false);
  });
});

describe("priority ↔ mandatory flag", () => {
  it("round-trips through the stored is_mandatory column", () => {
    expect(priorityFromMandatoryFlag(true)).toBe("must_have");
    expect(priorityFromMandatoryFlag(false)).toBe("nice_to_have");
    expect(mandatoryFlagFromPriority(priorityFromMandatoryFlag(true))).toBe(true);
    expect(mandatoryFlagFromPriority(priorityFromMandatoryFlag(false))).toBe(false);
  });

  it("derives importance rather than asking the recruiter for it", () => {
    expect(importanceFromPriority("must_have")).toBe("high");
    expect(importanceFromPriority("nice_to_have")).toBe("medium");
  });
});

describe("deriveResumeDimensionFields", () => {
  it("pins every must-have to the resume gate", () => {
    const derived = deriveResumeDimensionFields([
      { priority: "must_have" as const },
      { priority: "must_have" as const },
      { priority: "nice_to_have" as const },
    ]);

    expect(derived.map((d) => d.min_score)).toEqual([
      MUST_HAVE_MINIMUM_SCORE,
      MUST_HAVE_MINIMUM_SCORE,
      0,
    ]);
    expect(derived.map((d) => d.is_mandatory)).toEqual([true, true, false]);
  });

  it("writes a weight for backward compatibility without letting it gate anything", () => {
    const derived = deriveResumeDimensionFields([
      { priority: "must_have" as const },
      { priority: "nice_to_have" as const },
    ]);

    // A weight is present and normalized, but min_score — the only field the
    // gate reads — is set from priority alone.
    for (const d of derived) {
      expect(d.weight).toBeGreaterThan(0);
      expect(d.max_score).toBe(100);
    }
    expect(derived[0].min_score).toBe(MUST_HAVE_MINIMUM_SCORE);
    expect(derived[1].min_score).toBe(0);
  });

  it("preserves the caller's own fields", () => {
    const derived = deriveResumeDimensionFields([
      { priority: "must_have" as const, name: "TypeScript", sort_order: 0 },
    ]);

    expect(derived[0].name).toBe("TypeScript");
    expect(derived[0].sort_order).toBe(0);
  });
});
