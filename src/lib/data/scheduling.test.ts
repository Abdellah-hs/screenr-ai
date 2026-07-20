import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockFrom } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import {
  fetchBookingByGoogleEventId,
  markBookingPendingReschedule,
  setBookingCalendarEventId,
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
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (v: QueryResult) => unknown) => Promise<unknown>;
}

function makeQuery(result: QueryResult): QueryStub {
  const q: QueryStub = {
    update: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
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

describe("setBookingCalendarEventId", () => {
  it("stores the event id against the application's booking", async () => {
    const q = makeQuery({ data: null, error: null });
    mockFrom.mockReturnValue(q);

    await setBookingCalendarEventId("app-1", "evt-1");

    expect(q.update).toHaveBeenCalledWith({ google_event_id: "evt-1" });
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
