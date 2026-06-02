import { describe, it, expect } from "vitest";
import { deriveDimensionFields } from "./rubric-weights";

describe("deriveDimensionFields", () => {
  it("gives a lone dimension the full weight", () => {
    const [d] = deriveDimensionFields([{ importance: "medium", is_mandatory: false }]);

    expect(d.weight).toBe(1);
  });

  it("normalizes High/Medium/Low to points 3:2:1 of the total", () => {
    const result = deriveDimensionFields([
      { importance: "high", is_mandatory: false },
      { importance: "medium", is_mandatory: false },
      { importance: "low", is_mandatory: false },
    ]);

    expect(result.map((d) => d.weight)).toEqual([0.5, 0.33, 0.17]);
  });

  it("splits equal importance evenly", () => {
    const result = deriveDimensionFields([
      { importance: "high", is_mandatory: false },
      { importance: "high", is_mandatory: false },
    ]);

    expect(result.map((d) => d.weight)).toEqual([0.5, 0.5]);
  });

  it("sets the fail line to 30 for Must-Have and 0 for Nice-to-Have", () => {
    const result = deriveDimensionFields([
      { importance: "high", is_mandatory: true },
      { importance: "high", is_mandatory: false },
    ]);

    expect(result[0].min_score).toBe(30);
    expect(result[1].min_score).toBe(0);
  });

  it("always sets max_score to 100", () => {
    const result = deriveDimensionFields([
      { importance: "low", is_mandatory: true },
      { importance: "high", is_mandatory: false },
    ]);

    expect(result.every((d) => d.max_score === 100)).toBe(true);
  });

  it("preserves caller fields and returns weight 0 for an all-empty set", () => {
    expect(deriveDimensionFields([])).toEqual([]);
  });

  it("keeps importance independent of mandatory (a low-importance must-have)", () => {
    const result = deriveDimensionFields([
      { importance: "low", is_mandatory: true },
      { importance: "high", is_mandatory: false },
    ]);

    // Low importance → small weight, yet still a hard gate (min_score 30).
    expect(result[0].weight).toBe(0.25);
    expect(result[0].min_score).toBe(30);
  });
});
