import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockFetchGmailConnection, mockCreateInterviewEvent } =
  vi.hoisted(() => ({
    mockCreateAdminClient: vi.fn(),
    mockFetchGmailConnection: vi.fn(),
    mockCreateInterviewEvent: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/data/integrations", () => ({
  fetchGmailConnection: mockFetchGmailConnection,
}));

vi.mock("@/lib/services/calendar", () => ({
  createInterviewEvent: mockCreateInterviewEvent,
}));

// `hasCalendarScopes` stays real (pure) so the scope gate is actually exercised.

import { createBookingCalendarEvent } from "./booking-event";
import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
} from "@/lib/services/gmail";

const FULL_SCOPE = `https://www.googleapis.com/auth/gmail.modify ${CALENDAR_FREEBUSY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`;

const ADMIN_DB = { __brand: "admin-client" };

const BOOKING = {
  ownerUserId: "owner-1",
  applicationId: "app-123",
  candidateName: "Jane Doe",
  candidateEmail: "jane@example.com",
  campaignTitle: "Data scientist",
  startIso: "2026-07-11T08:00:00.000Z",
  slotMinutes: 45,
  timeZone: "Africa/Casablanca",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAdminClient.mockReturnValue(ADMIN_DB);
});

describe("createBookingCalendarEvent", () => {
  it("creates the event over the exact slot with the candidate invited, and returns the Meet URL", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: FULL_SCOPE,
    });
    mockCreateInterviewEvent.mockResolvedValue({
      eventId: "evt-1",
      meetUrl: "https://meet.google.com/abc-defg-hij",
    });

    const result = await createBookingCalendarEvent(BOOKING);

    expect(result).toEqual({ meetUrl: "https://meet.google.com/abc-defg-hij" });
    expect(mockCreateInterviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: "rt-1",
        startIso: "2026-07-11T08:00:00.000Z",
        // 45-minute slot → end is start + 45min.
        endIso: "2026-07-11T08:45:00.000Z",
        timeZone: "Africa/Casablanca",
        candidateEmail: "jane@example.com",
        candidateName: "Jane Doe",
        // Application id keys the Meet-room request so retries dedupe.
        requestId: "app-123",
      }),
    );
  });

  it("names the event after the candidate and the role", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: FULL_SCOPE,
    });
    mockCreateInterviewEvent.mockResolvedValue({ eventId: "evt-1", meetUrl: null });

    await createBookingCalendarEvent(BOOKING);

    const summary = mockCreateInterviewEvent.mock.calls[0][0].summary as string;
    expect(summary).toContain("Jane Doe");
    expect(summary).toContain("Data scientist");
  });

  it("skips the event (null Meet URL) when the owner has no calendar-enabled connection", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: "https://www.googleapis.com/auth/gmail.modify",
    });

    const result = await createBookingCalendarEvent(BOOKING);

    expect(result).toEqual({ meetUrl: null });
    expect(mockCreateInterviewEvent).not.toHaveBeenCalled();
  });

  it("skips the event when the owner has no connection at all", async () => {
    mockFetchGmailConnection.mockResolvedValue(null);

    const result = await createBookingCalendarEvent(BOOKING);

    expect(result).toEqual({ meetUrl: null });
    expect(mockCreateInterviewEvent).not.toHaveBeenCalled();
  });

  it("never throws when Google fails — the booking is already durable", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      scope: FULL_SCOPE,
    });
    mockCreateInterviewEvent.mockRejectedValue(new Error("Google 503"));

    await expect(createBookingCalendarEvent(BOOKING)).resolves.toEqual({
      meetUrl: null,
    });
  });
});
