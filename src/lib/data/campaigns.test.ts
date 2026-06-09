import { beforeEach, describe, it, expect, vi } from "vitest";

// Supabase chain mock for the query helpers:
//   from("campaigns").select(...).eq("id", …).eq("user_id", …).is("deleted_at", null).single()
const mockSingle = vi.fn();
const mockIs = vi.fn(() => ({ single: mockSingle }));
const mockEqUser = vi.fn(() => ({ is: mockIs }));
const mockEqId = vi.fn(() => ({ eq: mockEqUser }));
const mockSelect = vi.fn(() => ({ eq: mockEqId }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

import { dimensionsEqual, fetchCampaignApplicationEmail } from "./campaigns";
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

describe("fetchCampaignApplicationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the address scoped to the campaign and owning user", async () => {
    mockSingle.mockResolvedValue({
      data: { application_email: "careers+eng@company.com" },
      error: null,
    });

    const result = await fetchCampaignApplicationEmail("camp-1", "user-1");

    expect(result).toBe("careers+eng@company.com");
    expect(mockFrom).toHaveBeenCalledWith("campaigns");
    expect(mockEqId).toHaveBeenCalledWith("id", "camp-1");
    expect(mockEqUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null when the campaign has no address set", async () => {
    mockSingle.mockResolvedValue({ data: { application_email: null }, error: null });

    expect(await fetchCampaignApplicationEmail("camp-1", "user-1")).toBeNull();
  });

  it("returns null when the campaign is missing or not owned by the user", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    expect(await fetchCampaignApplicationEmail("camp-1", "user-1")).toBeNull();
  });
});
