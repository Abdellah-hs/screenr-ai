import { beforeEach, describe, it, expect, vi } from "vitest";

// Supabase chain mock for the query helpers:
//   from("campaigns").select(...).eq("id", …).eq("user_id", …).is("deleted_at", null).single()
const mockSingle = vi.fn();
const mockIs = vi.fn(() => ({ single: mockSingle }));
const mockEqUser = vi.fn(() => ({ is: mockIs }));
const mockEqId = vi.fn(() => ({ eq: mockEqUser }));
const mockSelect = vi.fn(() => ({ eq: mockEqId }));
// Return type is widened so describes below can override the implementation with
// update/insert chains (updateCampaignStatusTx) without a type clash.
const mockFrom = vi.fn((): Record<string, unknown> => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

import {
  dimensionsEqual,
  fetchCampaignApplicationEmail,
  fetchCampaignStatus,
  updateCampaignStatusTx,
  softDeleteCampaignTx,
  mapAvailabilityRows,
} from "./campaigns";
import type { DimensionImportance } from "@/lib/constants";

type AvailabilityRow = {
  id: string;
  campaign_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  created_at: string;
  updated_at: string;
};

function availabilityRow(overrides: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    id: "rule-1",
    campaign_id: "camp-1",
    weekday: 1,
    start_minute: 540,
    end_minute: 1020,
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
    ...overrides,
  };
}

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

describe("fetchCampaignStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the status scoped to the campaign and owning user", async () => {
    mockSingle.mockResolvedValue({ data: { status: "active" }, error: null });

    const result = await fetchCampaignStatus("camp-1", "user-1");

    expect(result).toBe("active");
    expect(mockFrom).toHaveBeenCalledWith("campaigns");
    expect(mockEqId).toHaveBeenCalledWith("id", "camp-1");
    expect(mockEqUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null when the campaign is missing or not owned", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    expect(await fetchCampaignStatus("camp-1", "user-1")).toBeNull();
  });
});

describe("mapAvailabilityRows", () => {
  it("maps rows to the domain shape (weekday + minutes only)", () => {
    const result = mapAvailabilityRows([availabilityRow()]);

    expect(result).toEqual([{ weekday: 1, start_minute: 540, end_minute: 1020 }]);
  });

  it("sorts by weekday, then by start time within a day", () => {
    const result = mapAvailabilityRows([
      availabilityRow({ weekday: 3, start_minute: 600 }),
      availabilityRow({ weekday: 1, start_minute: 780 }),
      availabilityRow({ weekday: 1, start_minute: 540 }),
    ]);

    expect(result.map((r) => [r.weekday, r.start_minute])).toEqual([
      [1, 540],
      [1, 780],
      [3, 600],
    ]);
  });

  it("returns an empty array for undefined or empty input", () => {
    expect(mapAvailabilityRows(undefined)).toEqual([]);
    expect(mapAvailabilityRows([])).toEqual([]);
  });
});

// Kept last: this overrides mockFrom's implementation to expose the update +
// insert chains, so it must not run before the select-based describes above.
describe("updateCampaignStatusTx", () => {
  const updateSingle = vi.fn();
  const auditInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") {
        return { insert: auditInsert };
      }
      // from("campaigns").update().eq().eq().is().select().single()
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ single: updateSingle }),
              }),
            }),
          }),
        }),
      };
    });
  });

  it("updates the status and appends a status-change audit row (old → new)", async () => {
    updateSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await updateCampaignStatusTx("camp-1", "draft", "active", "user-1");

    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        user_id: "user-1",
        action: "campaign_status_changed",
        old_data: { status: "draft" },
        new_data: { status: "active" },
      }),
    );
  });

  it("throws and skips the audit row when no owned row was updated", async () => {
    updateSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    await expect(
      updateCampaignStatusTx("camp-1", "draft", "active", "user-1"),
    ).rejects.toThrow();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});

// Same update + insert chain shape as updateCampaignStatusTx — kept last so the
// mockFrom override doesn't leak into the select-based describes above.
describe("softDeleteCampaignTx", () => {
  const updateSingle = vi.fn();
  const auditInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") {
        return { insert: auditInsert };
      }
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ single: updateSingle }),
              }),
            }),
          }),
        }),
      };
    });
  });

  it("sets deleted_at and appends a campaign_deleted audit row", async () => {
    updateSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await softDeleteCampaignTx("camp-1", "user-1");

    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        user_id: "user-1",
        action: "campaign_deleted",
      }),
    );
  });

  it("throws and skips the audit row when nothing was deleted", async () => {
    updateSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    await expect(softDeleteCampaignTx("camp-1", "user-1")).rejects.toThrow();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});
