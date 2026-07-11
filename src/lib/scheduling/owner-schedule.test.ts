import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockFetchGmailConnection, mockFetchCalendarSchedule } =
  vi.hoisted(() => ({
    mockCreateAdminClient: vi.fn(),
    mockFetchGmailConnection: vi.fn(),
    mockFetchCalendarSchedule: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/data/integrations", () => ({
  fetchGmailConnection: mockFetchGmailConnection,
}));

vi.mock("@/lib/services/calendar", () => ({
  fetchCalendarSchedule: mockFetchCalendarSchedule,
}));

// `hasCalendarScopes` stays real (pure) so the scope gate is actually exercised.

import { fetchOwnerSchedule } from "./owner-schedule";
import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
} from "@/lib/services/gmail";

const GMAIL_ONLY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const FULL_SCOPE = `${GMAIL_ONLY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`;

const ADMIN_DB = { __brand: "admin-client" };
const NOW = new Date("2026-07-08T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAdminClient.mockReturnValue(ADMIN_DB);
});

describe("fetchOwnerSchedule", () => {
  it("reads the owner's connection through the admin client (candidates have no session)", async () => {
    mockFetchGmailConnection.mockResolvedValue(null);

    await fetchOwnerSchedule({ ownerUserId: "owner-1", horizonDays: 14, now: NOW });

    expect(mockFetchGmailConnection).toHaveBeenCalledWith("owner-1", ADMIN_DB);
  });

  it("is unavailable when the owner has no Google connection", async () => {
    mockFetchGmailConnection.mockResolvedValue(null);

    const result = await fetchOwnerSchedule({
      ownerUserId: "owner-1",
      horizonDays: 14,
      now: NOW,
    });

    expect(result).toEqual({ available: false, reason: "not_connected" });
    expect(mockFetchCalendarSchedule).not.toHaveBeenCalled();
  });

  it("is unavailable when the stored grant lacks the calendar scopes (pre-calendar connection)", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: GMAIL_ONLY_SCOPE,
    });

    const result = await fetchOwnerSchedule({
      ownerUserId: "owner-1",
      horizonDays: 14,
      now: NOW,
    });

    expect(result).toEqual({ available: false, reason: "calendar_not_granted" });
    expect(mockFetchCalendarSchedule).not.toHaveBeenCalled();
  });

  it("returns windows, conflicts and timezone over a window padded past the booking horizon", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: FULL_SCOPE,
    });
    const schedule = {
      windows: [{ startIso: "2026-07-10T09:00:00.000Z", endIso: "2026-07-10T12:00:00.000Z" }],
      conflicts: [{ startIso: "2026-07-10T10:00:00.000Z", endIso: "2026-07-10T10:30:00.000Z" }],
      timeZone: "Africa/Casablanca",
    };
    mockFetchCalendarSchedule.mockResolvedValue(schedule);

    const result = await fetchOwnerSchedule({
      ownerUserId: "owner-1",
      horizonDays: 14,
      now: NOW,
    });

    expect(result).toEqual({ available: true, ...schedule });
    expect(mockFetchCalendarSchedule).toHaveBeenCalledWith({
      refreshToken: "rt-1",
      timeMinIso: "2026-07-08T12:00:00.000Z",
      // horizon 14 days + 2-day pad, so the last offered calendar day is covered.
      timeMaxIso: "2026-07-24T12:00:00.000Z",
    });
  });

  it("is unavailable (never silently free) when the calendar read fails", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: FULL_SCOPE,
    });
    mockFetchCalendarSchedule.mockRejectedValue(new Error("Google 503"));

    const result = await fetchOwnerSchedule({
      ownerUserId: "owner-1",
      horizonDays: 14,
      now: NOW,
    });

    expect(result).toEqual({ available: false, reason: "lookup_failed" });
  });
});
