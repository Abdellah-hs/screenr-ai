import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchOwnerSchedule, mockFetchBookedSlotIsos } = vi.hoisted(() => ({
  mockFetchOwnerSchedule: vi.fn(),
  mockFetchBookedSlotIsos: vi.fn(),
}));

vi.mock("@/lib/scheduling/owner-schedule", () => ({
  fetchOwnerSchedule: mockFetchOwnerSchedule,
}));

vi.mock("@/lib/data/scheduling", () => ({
  fetchBookedSlotIsos: mockFetchBookedSlotIsos,
}));

// The pure slot helpers stay real so the busy-filtering / booked-exclusion /
// buffer math is actually exercised, not mocked away.
import { resolveAvailableSlots } from "./available-slots";

const CTX = {
  owner_user_id: "owner-1",
  booking_horizon_days: 14,
  campaign_id: "camp-1",
  slot_minutes: 30,
  timezone: "UTC" as string | null,
};

// A 09:00–10:30 UTC window yields three 30-min slots: 09:00, 09:30, 10:00.
const WINDOW = {
  startIso: "2026-07-10T09:00:00.000Z",
  endIso: "2026-07-10T10:30:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Fix "now" before the window so slot lead-time exclusion is deterministic
  // (resolveAvailableSlots doesn't forward `now`, so the generators read the clock).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-10T06:00:00.000Z"));
  mockFetchBookedSlotIsos.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveAvailableSlots", () => {
  it("forwards the calendar-unavailable reason and never reads booked slots", async () => {
    mockFetchOwnerSchedule.mockResolvedValue({ available: false, reason: "not_connected" });

    const result = await resolveAvailableSlots(CTX);

    expect(result).toEqual({ status: "calendar_unavailable", reason: "not_connected" });
    expect(mockFetchBookedSlotIsos).not.toHaveBeenCalled();
  });

  it("reports no_hours (and skips the booked read) when the calendar has no windows", async () => {
    mockFetchOwnerSchedule.mockResolvedValue({
      available: true,
      windows: [],
      conflicts: [],
      timeZone: "Africa/Casablanca",
    });

    const result = await resolveAvailableSlots(CTX);

    expect(result).toEqual({ status: "no_hours", timezone: "Africa/Casablanca" });
    expect(mockFetchBookedSlotIsos).not.toHaveBeenCalled();
  });

  it("falls back to the campaign timezone, then UTC, when the calendar reports none", async () => {
    mockFetchOwnerSchedule.mockResolvedValue({
      available: true,
      windows: [],
      conflicts: [],
      timeZone: null,
    });

    const withCampaignTz = await resolveAvailableSlots({ ...CTX, timezone: "Europe/Paris" });
    const withNothing = await resolveAvailableSlots({ ...CTX, timezone: null });

    expect(withCampaignTz).toMatchObject({ timezone: "Europe/Paris" });
    expect(withNothing).toMatchObject({ timezone: "UTC" });
  });

  it("returns the slots chopped from the published window", async () => {
    mockFetchOwnerSchedule.mockResolvedValue({
      available: true,
      windows: [WINDOW],
      conflicts: [],
      timeZone: "UTC",
    });

    const result = await resolveAvailableSlots(CTX);

    expect(result).toEqual({
      status: "ok",
      timezone: "UTC",
      slots: [
        expect.objectContaining({ startIso: "2026-07-10T09:00:00.000Z" }),
        expect.objectContaining({ startIso: "2026-07-10T09:30:00.000Z" }),
        expect.objectContaining({ startIso: "2026-07-10T10:00:00.000Z" }),
      ],
    });
  });

  it("excludes slot starts that are already booked", async () => {
    mockFetchOwnerSchedule.mockResolvedValue({
      available: true,
      windows: [WINDOW],
      conflicts: [],
      timeZone: "UTC",
    });
    mockFetchBookedSlotIsos.mockResolvedValue(["2026-07-10T09:30:00.000Z"]);

    const result = await resolveAvailableSlots(CTX);

    const starts =
      result.status === "ok" ? result.slots.map((s) => s.startIso) : [];
    expect(starts).toEqual([
      "2026-07-10T09:00:00.000Z",
      "2026-07-10T10:00:00.000Z",
    ]);
  });

  it("clears slots around a conflict by the interview buffer, not just the raw meeting", async () => {
    // A 15-min meeting, once padded by the 15-min buffer, spans 09:15–10:00 and
    // so knocks out the 09:00 and 09:30 slots, leaving only 10:00.
    mockFetchOwnerSchedule.mockResolvedValue({
      available: true,
      windows: [WINDOW],
      conflicts: [
        { startIso: "2026-07-10T09:30:00.000Z", endIso: "2026-07-10T09:45:00.000Z" },
      ],
      timeZone: "UTC",
    });

    const result = await resolveAvailableSlots(CTX);

    const starts =
      result.status === "ok" ? result.slots.map((s) => s.startIso) : [];
    expect(starts).toEqual(["2026-07-10T10:00:00.000Z"]);
  });
});
