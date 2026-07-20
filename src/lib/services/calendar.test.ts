import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSetCredentials,
  mockOAuth2,
  mockEventsList,
  mockEventsInsert,
  mockEventsPatch,
  mockEventsWatch,
  mockChannelsStop,
  mockCalendarFactory,
} = vi.hoisted(() => {
    const mockSetCredentials = vi.fn();
    // Constructor-style mock: invoked via `new google.auth.OAuth2(...)`, so the
    // implementation must assign to `this` (an arrow fn can't be `new`-ed).
    const mockOAuth2 = vi.fn(function (
      this: { setCredentials: typeof mockSetCredentials },
    ) {
      this.setCredentials = mockSetCredentials;
    });
    const mockEventsList = vi.fn();
    const mockEventsInsert = vi.fn();
    const mockEventsPatch = vi.fn();
    const mockEventsWatch = vi.fn();
    const mockChannelsStop = vi.fn();
    const mockCalendarFactory = vi.fn(() => ({
      events: {
        list: mockEventsList,
        insert: mockEventsInsert,
        patch: mockEventsPatch,
        watch: mockEventsWatch,
      },
      channels: { stop: mockChannelsStop },
    }));
    return {
      mockSetCredentials,
      mockOAuth2,
      mockEventsList,
      mockEventsInsert,
      mockEventsPatch,
      mockEventsWatch,
      mockChannelsStop,
      mockCalendarFactory,
    };
  });

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: mockOAuth2 },
    calendar: mockCalendarFactory,
  },
}));

import {
  createInterviewEvent,
  fetchCalendarSchedule,
  listChangedCalendarEvents,
  stopCalendarWatch,
  SyncTokenExpiredError,
  updateInterviewEvent,
  watchCalendarEvents,
} from "./calendar";

const WINDOW = {
  refreshToken: "rt-1",
  timeMinIso: "2026-07-08T00:00:00.000Z",
  timeMaxIso: "2026-07-22T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("fetchCalendarSchedule", () => {
  function eventsResponse(items: object[], timeZone: string | null = "Europe/Paris") {
    return { data: { items, timeZone } };
  }

  function timed(start: string, end: string, extra: object = {}) {
    return { start: { dateTime: start }, end: { dateTime: end }, ...extra };
  }

  it("binds the recruiter's refresh token to an OAuth client built from env credentials", async () => {
    mockEventsList.mockResolvedValue(eventsResponse([]));

    await fetchCalendarSchedule(WINDOW);

    expect(mockOAuth2).toHaveBeenCalledWith("test-client-id", "test-client-secret");
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: "rt-1" });
  });

  it("requests the primary calendar's expanded events for exactly the window", async () => {
    mockEventsList.mockResolvedValue(eventsResponse([]));

    await fetchCalendarSchedule(WINDOW);

    expect(mockEventsList).toHaveBeenCalledWith({
      calendarId: "primary",
      timeMin: "2026-07-08T00:00:00.000Z",
      timeMax: "2026-07-22T00:00:00.000Z",
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
    });
  });

  it("classifies an ordinary meeting as a conflict", async () => {
    mockEventsList.mockResolvedValue(
      eventsResponse([
        timed("2026-07-09T10:00:00Z", "2026-07-09T10:30:00Z", { summary: "1:1 sync" }),
      ]),
    );

    const schedule = await fetchCalendarSchedule(WINDOW);

    expect(schedule.conflicts).toEqual([
      { startIso: "2026-07-09T10:00:00.000Z", endIso: "2026-07-09T10:30:00.000Z" },
    ]);
  });

  it("classifies a legacy 'Interview hours'-titled event as an ordinary conflict — titles no longer carry meaning", async () => {
    mockEventsList.mockResolvedValue(
      eventsResponse([
        timed("2026-07-09T09:00:00+02:00", "2026-07-09T12:00:00+02:00", {
          summary: "INTERVIEW Hours — final round",
        }),
      ]),
    );

    const schedule = await fetchCalendarSchedule(WINDOW);

    expect(schedule.conflicts).toEqual([
      { startIso: "2026-07-09T07:00:00.000Z", endIso: "2026-07-09T10:00:00.000Z" },
    ]);
  });

  it("ignores events marked Free, declined meetings, and working-location markers", async () => {
    mockEventsList.mockResolvedValue(
      eventsResponse([
        timed("2026-07-09T10:00:00Z", "2026-07-09T11:00:00Z", {
          summary: "Held (free)",
          transparency: "transparent",
        }),
        timed("2026-07-09T11:00:00Z", "2026-07-09T12:00:00Z", {
          summary: "Declined meeting",
          attendees: [{ self: true, responseStatus: "declined" }],
        }),
        timed("2026-07-09T12:00:00Z", "2026-07-09T13:00:00Z", {
          summary: "Office",
          eventType: "workingLocation",
        }),
      ]),
    );

    const schedule = await fetchCalendarSchedule(WINDOW);

    expect(schedule.conflicts).toEqual([]);
  });

  it("treats an all-day out-of-office as blocking the whole local day", async () => {
    mockEventsList.mockResolvedValue(
      eventsResponse(
        [
          {
            summary: "Vacation",
            eventType: "outOfOffice",
            start: { date: "2026-07-10" },
            end: { date: "2026-07-11" },
          },
        ],
        "Europe/Paris", // UTC+2 in July
      ),
    );

    const schedule = await fetchCalendarSchedule(WINDOW);

    expect(schedule.conflicts).toEqual([
      { startIso: "2026-07-09T22:00:00.000Z", endIso: "2026-07-10T22:00:00.000Z" },
    ]);
  });

  it("blocks the whole day for an all-day event explicitly marked Busy, but ignores default Free ones", async () => {
    mockEventsList.mockResolvedValue(
      eventsResponse(
        [
          {
            summary: "Offsite (busy)",
            start: { date: "2026-07-10" },
            end: { date: "2026-07-11" },
          },
          {
            summary: "Alice's birthday",
            transparency: "transparent",
            start: { date: "2026-07-10" },
            end: { date: "2026-07-11" },
          },
        ],
        "UTC",
      ),
    );

    const schedule = await fetchCalendarSchedule(WINDOW);

    expect(schedule.conflicts).toEqual([
      { startIso: "2026-07-10T00:00:00.000Z", endIso: "2026-07-11T00:00:00.000Z" },
    ]);
  });

  it("passes the calendar timezone through, and null when Google omits it", async () => {
    mockEventsList.mockResolvedValueOnce(eventsResponse([], "America/New_York"));
    expect((await fetchCalendarSchedule(WINDOW)).timeZone).toBe("America/New_York");

    mockEventsList.mockResolvedValueOnce({ data: { items: [] } });
    expect((await fetchCalendarSchedule(WINDOW)).timeZone).toBeNull();
  });

  it("propagates API errors so the caller owns the strict fallback decision", async () => {
    mockEventsList.mockRejectedValue(new Error("insufficient authentication scopes"));

    await expect(fetchCalendarSchedule(WINDOW)).rejects.toThrow(
      "insufficient authentication scopes",
    );
  });

  it("throws when the OAuth app credentials are missing from env", async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(fetchCalendarSchedule(WINDOW)).rejects.toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe("createInterviewEvent", () => {
  const EVENT = {
    refreshToken: "rt-1",
    summary: "Final interview: Jane Doe — Data scientist",
    description: "Scheduled via Screenr AI.",
    startIso: "2026-07-11T08:00:00.000Z",
    endIso: "2026-07-11T08:45:00.000Z",
    timeZone: "Africa/Casablanca",
    candidateEmail: "jane@example.com",
    candidateName: "Jane Doe",
    requestId: "app-123",
  };

  it("inserts the event on the primary calendar with the candidate as guest and a Meet room requested", async () => {
    mockEventsInsert.mockResolvedValue({ data: {} });

    await createInterviewEvent(EVENT);

    expect(mockEventsInsert).toHaveBeenCalledWith({
      calendarId: "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: "Final interview: Jane Doe — Data scientist",
        description: "Scheduled via Screenr AI.",
        start: { dateTime: "2026-07-11T08:00:00.000Z", timeZone: "Africa/Casablanca" },
        end: { dateTime: "2026-07-11T08:45:00.000Z", timeZone: "Africa/Casablanca" },
        attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
        conferenceData: {
          createRequest: {
            requestId: "app-123",
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
  });

  it("returns the Meet URL from the conference entry points", async () => {
    mockEventsInsert.mockResolvedValue({
      data: {
        id: "evt-1",
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1234" },
            { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
          ],
        },
      },
    });

    const result = await createInterviewEvent(EVENT);

    expect(result).toEqual({
      eventId: "evt-1",
      meetUrl: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("falls back to hangoutLink when entry points are missing", async () => {
    mockEventsInsert.mockResolvedValue({
      data: { id: "evt-1", hangoutLink: "https://meet.google.com/xyz" },
    });

    const result = await createInterviewEvent(EVENT);

    expect(result.meetUrl).toBe("https://meet.google.com/xyz");
  });

  it("returns null ids when Google attached no conference", async () => {
    mockEventsInsert.mockResolvedValue({ data: {} });

    const result = await createInterviewEvent(EVENT);

    expect(result).toEqual({ eventId: null, meetUrl: null });
  });

  it("propagates API errors — the caller owns the best-effort decision", async () => {
    mockEventsInsert.mockRejectedValue(new Error("insufficient authentication scopes"));

    await expect(createInterviewEvent(EVENT)).rejects.toThrow(
      "insufficient authentication scopes",
    );
  });
});

describe("updateInterviewEvent", () => {
  const MOVE = {
    refreshToken: "rt-1",
    eventId: "evt-1",
    startIso: "2026-07-12T09:00:00.000Z",
    endIso: "2026-07-12T09:45:00.000Z",
    timeZone: "Africa/Casablanca",
  };

  it("patches only start and end, preserving attendees/description/Meet via the merge", async () => {
    mockEventsPatch.mockResolvedValue({ data: {} });

    await updateInterviewEvent(MOVE);

    expect(mockEventsPatch).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt-1",
      sendUpdates: "all",
      requestBody: {
        start: { dateTime: "2026-07-12T09:00:00.000Z", timeZone: "Africa/Casablanca" },
        end: { dateTime: "2026-07-12T09:45:00.000Z", timeZone: "Africa/Casablanca" },
      },
    });
  });

  it("returns the preserved event id and Meet link from the patch response", async () => {
    mockEventsPatch.mockResolvedValue({
      data: {
        id: "evt-1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      },
    });

    const result = await updateInterviewEvent(MOVE);

    expect(result).toEqual({
      eventId: "evt-1",
      meetUrl: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("propagates API errors so the caller can fall back to a fresh insert", async () => {
    mockEventsPatch.mockRejectedValue(new Error("Not Found"));

    await expect(updateInterviewEvent(MOVE)).rejects.toThrow("Not Found");
  });
});

describe("watchCalendarEvents", () => {
  const WATCH = {
    refreshToken: "rt-1",
    address: "https://app.example.com/api/webhooks/google-calendar",
    channelId: "chan-abc",
    channelToken: "tok-secret",
  };

  it("opens a web_hook channel on the primary calendar with our id, token and address", async () => {
    mockEventsWatch.mockResolvedValue({ data: {} });

    await watchCalendarEvents(WATCH);

    expect(mockEventsWatch).toHaveBeenCalledWith({
      calendarId: "primary",
      requestBody: {
        id: "chan-abc",
        type: "web_hook",
        address: "https://app.example.com/api/webhooks/google-calendar",
        token: "tok-secret",
      },
    });
  });

  it("normalizes the unix-ms expiration string to an ISO instant", async () => {
    // 1_784_000_000_000 ms = 2026-07-11T... UTC.
    mockEventsWatch.mockResolvedValue({
      data: { resourceId: "res-1", expiration: "1784000000000" },
    });

    const result = await watchCalendarEvents(WATCH);

    expect(result).toEqual({
      resourceId: "res-1",
      expirationIso: new Date(1784000000000).toISOString(),
    });
  });

  it("returns null fields when Google omits resourceId and expiration", async () => {
    mockEventsWatch.mockResolvedValue({ data: {} });

    expect(await watchCalendarEvents(WATCH)).toEqual({
      resourceId: null,
      expirationIso: null,
    });
  });
});

describe("stopCalendarWatch", () => {
  it("stops the channel by id and resourceId", async () => {
    mockChannelsStop.mockResolvedValue({});

    await stopCalendarWatch({
      refreshToken: "rt-1",
      channelId: "chan-abc",
      resourceId: "res-1",
    });

    expect(mockChannelsStop).toHaveBeenCalledWith({
      requestBody: { id: "chan-abc", resourceId: "res-1" },
    });
  });
});

describe("listChangedCalendarEvents", () => {
  it("uses the sync token (not timeMin) for an incremental sync", async () => {
    mockEventsList.mockResolvedValue({ data: { items: [], nextSyncToken: "sync-2" } });

    const result = await listChangedCalendarEvents({
      refreshToken: "rt-1",
      syncToken: "sync-1",
    });

    expect(mockEventsList).toHaveBeenCalledWith({
      calendarId: "primary",
      singleEvents: true,
      pageToken: undefined,
      syncToken: "sync-1",
    });
    expect(result.nextSyncToken).toBe("sync-2");
  });

  it("falls back to timeMin for a full sync when no sync token is given", async () => {
    mockEventsList.mockResolvedValue({ data: { items: [], nextSyncToken: "sync-1" } });

    await listChangedCalendarEvents({
      refreshToken: "rt-1",
      timeMinIso: "2026-07-09T00:00:00.000Z",
    });

    expect(mockEventsList).toHaveBeenCalledWith({
      calendarId: "primary",
      singleEvents: true,
      pageToken: undefined,
      timeMin: "2026-07-09T00:00:00.000Z",
    });
  });

  it("paginates across pages and only keeps the final page's sync token", async () => {
    mockEventsList
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "e1", start: { dateTime: "2026-07-12T09:00:00Z" }, status: "confirmed" }],
          nextPageToken: "page-2",
          // A sync token on a non-final page must be ignored.
          nextSyncToken: "premature-token",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "e2", start: { dateTime: "2026-07-13T10:00:00Z" }, status: "cancelled" }],
          nextSyncToken: "final-token",
        },
      });

    const result = await listChangedCalendarEvents({ refreshToken: "rt-1", syncToken: "s0" });

    expect(mockEventsList).toHaveBeenCalledTimes(2);
    expect(mockEventsList).toHaveBeenLastCalledWith({
      calendarId: "primary",
      singleEvents: true,
      pageToken: "page-2",
      syncToken: "s0",
    });
    expect(result.events).toEqual([
      { eventId: "e1", startIso: "2026-07-12T09:00:00.000Z", status: "confirmed" },
      { eventId: "e2", startIso: "2026-07-13T10:00:00.000Z", status: "cancelled" },
    ]);
    expect(result.nextSyncToken).toBe("final-token");
  });

  it("maps an all-day (date-only) changed event to a null start", async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{ id: "e1", start: { date: "2026-07-12" }, status: "confirmed" }],
        nextSyncToken: "s1",
      },
    });

    const result = await listChangedCalendarEvents({ refreshToken: "rt-1", syncToken: "s0" });

    expect(result.events).toEqual([{ eventId: "e1", startIso: null, status: "confirmed" }]);
  });

  it("throws SyncTokenExpiredError on a 410 so the caller can full-resync", async () => {
    mockEventsList.mockRejectedValue(Object.assign(new Error("Gone"), { code: 410 }));

    await expect(
      listChangedCalendarEvents({ refreshToken: "rt-1", syncToken: "stale" }),
    ).rejects.toBeInstanceOf(SyncTokenExpiredError);
  });

  it("propagates non-410 errors unchanged", async () => {
    mockEventsList.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));

    await expect(
      listChangedCalendarEvents({ refreshToken: "rt-1", syncToken: "s0" }),
    ).rejects.toThrow("boom");
  });
});
