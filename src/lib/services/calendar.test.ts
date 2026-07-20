import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSetCredentials,
  mockOAuth2,
  mockEventsList,
  mockEventsInsert,
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
    const mockCalendarFactory = vi.fn(() => ({
      events: { list: mockEventsList, insert: mockEventsInsert },
    }));
    return {
      mockSetCredentials,
      mockOAuth2,
      mockEventsList,
      mockEventsInsert,
      mockCalendarFactory,
    };
  });

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: mockOAuth2 },
    calendar: mockCalendarFactory,
  },
}));

import { createInterviewEvent, fetchCalendarSchedule } from "./calendar";

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
