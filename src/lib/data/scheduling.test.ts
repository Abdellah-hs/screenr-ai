import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockFrom } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import {
  claimInterviewReminder,
  fetchBookingByGoogleEventId,
  fetchBookingsInReminderWindow,
  markBookingPendingReschedule,
  releaseInterviewReminder,
  setBookingCalendarLink,
  SlotTakenError,
  updateBooking,
} from "./scheduling";

/** Result a terminal Supabase call resolves to. */
type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

/**
 * A chainable, awaitable Supabase query-builder stub. Every filter/mutator
 * returns the same object (so calls chain), and the object is thenable +
 * exposes maybeSingle, both resolving to `result`. Recorded calls are asserted
 * against to prove the right query was built.
 */
interface QueryStub {
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (v: QueryResult) => unknown) => Promise<unknown>;
}

function makeQuery(result: QueryResult): QueryStub {
  const q: QueryStub = {
    update: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    is: vi.fn(() => q),
    gt: vi.fn(() => q),
    lte: vi.fn(() => q),
    or: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAdminClient.mockReturnValue({ from: mockFrom });
});

describe("markBookingPendingReschedule", () => {
  it("conditionally flips only a currently-booked row and reports the transition", async () => {
    const q = makeQuery({ data: [{ id: "b1" }], error: null });
    mockFrom.mockReturnValue(q);

    const flipped = await markBookingPendingReschedule("app-1");

    expect(flipped).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("interview_bookings");
    expect(q.update).toHaveBeenCalledWith({ status: "pending_reschedule" });
    // The compare-and-swap: application match AND status still 'booked'.
    expect(q.eq).toHaveBeenCalledWith("application_id", "app-1");
    expect(q.eq).toHaveBeenCalledWith("status", "booked");
  });

  it("reports no transition when no booked row matched (duplicate delivery)", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: [], error: null }));

    expect(await markBookingPendingReschedule("app-1")).toBe(false);
  });

  it("throws when the update errors", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: null, error: { message: "boom" } }));

    await expect(markBookingPendingReschedule("app-1")).rejects.toThrow("boom");
  });
});

describe("updateBooking", () => {
  const PARAMS = {
    applicationId: "app-1",
    scheduledAtIso: "2026-07-12T09:00:00.000Z",
    slotMinutes: 30,
    timezone: "UTC",
  };

  it("writes the new time and re-books only a pending_reschedule row", async () => {
    const q = makeQuery({ data: [{ id: "b1" }], error: null });
    mockFrom.mockReturnValue(q);

    const applied = await updateBooking(PARAMS);

    expect(applied).toBe(true);
    expect(q.update).toHaveBeenCalledWith({
      scheduled_at: "2026-07-12T09:00:00.000Z",
      slot_minutes: 30,
      timezone: "UTC",
      status: "booked",
      reminder_24h_sent_at: null,
      reminder_1h_sent_at: null,
    });
    expect(q.eq).toHaveBeenCalledWith("application_id", "app-1");
    expect(q.eq).toHaveBeenCalledWith("status", "pending_reschedule");
  });

  it("reports no match when the booking was no longer pending (raced)", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: [], error: null }));

    expect(await updateBooking(PARAMS)).toBe(false);
  });

  it("throws SlotTakenError when the new time collides with another booking", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: null, error: { code: "23505" } }));

    await expect(updateBooking(PARAMS)).rejects.toBeInstanceOf(SlotTakenError);
  });
});

describe("setBookingCalendarLink", () => {
  it("stores the event id against the application's booking", async () => {
    const q = makeQuery({ data: null, error: null });
    mockFrom.mockReturnValue(q);

    await setBookingCalendarLink({ applicationId: "app-1", eventId: "evt-1" });

    expect(q.update).toHaveBeenCalledWith({ google_event_id: "evt-1" });
    expect(q.eq).toHaveBeenCalledWith("application_id", "app-1");
  });

  it("stores the Meet link alongside it, so reminders can carry a join url", async () => {
    const q = makeQuery({ data: null, error: null });
    mockFrom.mockReturnValue(q);

    await setBookingCalendarLink({
      applicationId: "app-1",
      eventId: "evt-1",
      meetUrl: "https://meet.google.com/abc",
    });

    expect(q.update).toHaveBeenCalledWith({
      google_event_id: "evt-1",
      meet_url: "https://meet.google.com/abc",
    });
  });

  /**
   * A reschedule that couldn't re-read the link must leave the good one alone
   * rather than blanking it — a booking with no join url is worse than a stale
   * one, because Google keeps the same Meet room across a move.
   */
  it("leaves an existing Meet link untouched when none was supplied", async () => {
    const q = makeQuery({ data: null, error: null });
    mockFrom.mockReturnValue(q);

    await setBookingCalendarLink({ applicationId: "app-1", eventId: "evt-1", meetUrl: null });

    expect(q.update).toHaveBeenCalledWith({ google_event_id: "evt-1" });
  });
});

describe("updateBooking — reminder reset", () => {
  it("clears both reminder stamps so the new time gets its own reminders", async () => {
    const q = makeQuery({ data: [{ id: "b1" }], error: null });
    mockFrom.mockReturnValue(q);

    await updateBooking({
      applicationId: "app-1",
      scheduledAtIso: "2026-07-11T09:00:00.000Z",
      slotMinutes: 30,
      timezone: "Africa/Casablanca",
    });

    expect(q.update).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_24h_sent_at: null, reminder_1h_sent_at: null }),
    );
  });
});

describe("fetchBookingsInReminderWindow", () => {
  const NOW = new Date("2026-09-10T09:00:00.000Z");

  const ROW = {
    application_id: "app-1",
    campaign_id: "camp-1",
    scheduled_at: "2026-09-11T05:00:00.000Z",
    created_at: "2026-09-01T09:00:00.000Z",
    status: "booked",
    timezone: "Africa/Casablanca",
    meet_url: "https://meet.google.com/abc",
    reminder_24h_sent_at: null,
    reminder_1h_sent_at: null,
    campaigns: { title: "Senior Engineer", user_id: "owner-1" },
    applications: {
      status: "final_interview_scheduling",
      candidates: { first_name: "Jane", last_name: "Doe", email: "jane@example.com" },
    },
  };

  it("asks only for still-booked interviews inside the window", async () => {
    const q = makeQuery({ data: [ROW], error: null });
    mockFrom.mockReturnValue(q);

    await fetchBookingsInReminderWindow(NOW, 24 * 60 * 60 * 1000);

    expect(mockFrom).toHaveBeenCalledWith("interview_bookings");
    expect(q.eq).toHaveBeenCalledWith("status", "booked");
    expect(q.gt).toHaveBeenCalledWith("scheduled_at", NOW.toISOString());
    expect(q.lte).toHaveBeenCalledWith("scheduled_at", "2026-09-11T09:00:00.000Z");
  });

  /**
   * A day whose reminders have all gone out should cost the sweep nothing to
   * look at, so rows with both stamps set never leave the database.
   */
  it("excludes bookings whose reminders have all been sent", async () => {
    const q = makeQuery({ data: [], error: null });
    mockFrom.mockReturnValue(q);

    await fetchBookingsInReminderWindow(NOW, 60_000);

    expect(q.or).toHaveBeenCalledWith(
      "reminder_24h_sent_at.is.null,reminder_1h_sent_at.is.null",
    );
  });

  it("flattens the campaign, application and candidate an email needs", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: [ROW], error: null }));

    const [booking] = await fetchBookingsInReminderWindow(NOW, 60_000);

    expect(booking).toMatchObject({
      campaign_title: "Senior Engineer",
      owner_user_id: "owner-1",
      application_status: "final_interview_scheduling",
      candidate_name: "Jane Doe",
      candidate_email: "jane@example.com",
    });
  });

  it("surfaces a query failure rather than reporting an empty day", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: null, error: { message: "boom" } }));

    await expect(fetchBookingsInReminderWindow(NOW, 60_000)).rejects.toThrow(/boom/);
  });
});

describe("claimInterviewReminder", () => {
  /**
   * The claim is what makes a duplicate reminder impossible rather than
   * unlikely: two overlapping sweep runs both try, and the `IS NULL` filter
   * means only one can match the row.
   */
  it("only claims a reminder that has not already gone out", async () => {
    const q = makeQuery({ data: [{ id: "b1" }], error: null });
    mockFrom.mockReturnValue(q);

    const won = await claimInterviewReminder({
      applicationId: "app-1",
      kind: "24h",
      at: new Date("2026-09-10T09:00:00.000Z"),
    });

    expect(won).toBe(true);
    expect(q.update).toHaveBeenCalledWith({
      reminder_24h_sent_at: "2026-09-10T09:00:00.000Z",
    });
    expect(q.is).toHaveBeenCalledWith("reminder_24h_sent_at", null);
  });

  it("reports a lost claim when another run already stamped the row", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: [], error: null }));

    const won = await claimInterviewReminder({
      applicationId: "app-1",
      kind: "1h",
      at: new Date(),
    });

    expect(won).toBe(false);
  });

  it("writes the 1h stamp to its own column", async () => {
    const q = makeQuery({ data: [{ id: "b1" }], error: null });
    mockFrom.mockReturnValue(q);

    await claimInterviewReminder({
      applicationId: "app-1",
      kind: "1h",
      at: new Date("2026-09-10T09:00:00.000Z"),
    });

    expect(q.is).toHaveBeenCalledWith("reminder_1h_sent_at", null);
  });
});

describe("releaseInterviewReminder", () => {
  it("clears the stamp so a failed send is retried next run", async () => {
    const q = makeQuery({ data: null, error: null });
    mockFrom.mockReturnValue(q);

    await releaseInterviewReminder({ applicationId: "app-1", kind: "24h" });

    expect(q.update).toHaveBeenCalledWith({ reminder_24h_sent_at: null });
    expect(q.eq).toHaveBeenCalledWith("application_id", "app-1");
  });
});

describe("fetchBookingByGoogleEventId", () => {
  it("looks a booking up by its Google event id", async () => {
    const q = makeQuery({
      data: { application_id: "app-1", scheduled_at: "2026-07-10T09:00:00.000Z", status: "booked" },
      error: null,
    });
    mockFrom.mockReturnValue(q);

    const booking = await fetchBookingByGoogleEventId("evt-1");

    expect(q.eq).toHaveBeenCalledWith("google_event_id", "evt-1");
    expect(booking).toEqual({
      application_id: "app-1",
      scheduled_at: "2026-07-10T09:00:00.000Z",
      status: "booked",
    });
  });

  it("returns null when the changed event isn't one of ours", async () => {
    mockFrom.mockReturnValue(makeQuery({ data: null, error: null }));

    expect(await fetchBookingByGoogleEventId("evt-unknown")).toBeNull();
  });
});
