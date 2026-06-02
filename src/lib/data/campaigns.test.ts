import { describe, it, expect } from "vitest";
import { dimensionsEqual } from "./campaigns";
import type { RubricDimension } from "@/lib/constants";

function dim(overrides: Partial<Omit<RubricDimension, "id">> = {}): Omit<RubricDimension, "id"> {
  return {
    name: "React",
    weight: 0.5,
    is_mandatory: true,
    min_score: 30,
    max_score: 100,
    sort_order: 0,
    ...overrides,
  };
}

describe("dimensionsEqual", () => {
  it("returns true for identical dimension sets", () => {
    const a = [dim(), dim({ name: "Tests", sort_order: 1, is_mandatory: false })];
    const b = [dim(), dim({ name: "Tests", sort_order: 1, is_mandatory: false })];

    expect(dimensionsEqual(a, b)).toBe(true);
  });

  it("ignores array order (compares as sets)", () => {
    const a = [dim({ name: "React", sort_order: 0 }), dim({ name: "Tests", sort_order: 1 })];
    const b = [dim({ name: "Tests", sort_order: 1 }), dim({ name: "React", sort_order: 0 })];

    expect(dimensionsEqual(a, b)).toBe(true);
  });

  it("returns false when a field changed (min_score)", () => {
    const a = [dim({ min_score: 30 })];
    const b = [dim({ min_score: 50 })];

    expect(dimensionsEqual(a, b)).toBe(false);
  });

  it("returns false when counts differ", () => {
    const a = [dim()];
    const b = [dim(), dim({ name: "Tests", sort_order: 1 })];

    expect(dimensionsEqual(a, b)).toBe(false);
  });

  it("treats two empty sets as equal", () => {
    expect(dimensionsEqual([], [])).toBe(true);
  });
});
