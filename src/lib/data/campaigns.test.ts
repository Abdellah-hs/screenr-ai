import { describe, it, expect } from "vitest";
import { dimensionsEqual } from "./campaigns";
import type { DimensionImportance } from "@/lib/constants";

type Intent = {
  name: string;
  importance: DimensionImportance;
  is_mandatory: boolean;
  sort_order: number;
};

function dim(overrides: Partial<Intent> = {}): Intent {
  return {
    name: "React",
    importance: "high",
    is_mandatory: true,
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

  it("returns false when importance changed", () => {
    const a = [dim({ importance: "high" })];
    const b = [dim({ importance: "low" })];

    expect(dimensionsEqual(a, b)).toBe(false);
  });

  it("returns false when Must-Have changed", () => {
    const a = [dim({ is_mandatory: true })];
    const b = [dim({ is_mandatory: false })];

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
