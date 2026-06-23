import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUserId, mockFetchBookingForRecruiter } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchBookingForRecruiter: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/data/scheduling", () => ({
  fetchBookingForRecruiter: mockFetchBookingForRecruiter,
}));

import { getInterviewBooking } from "./schedule";

const VALID_APP_ID = "550e8400-e29b-41d4-a716-446655440000";
const BOOKING = {
  scheduled_at: "2026-06-24T13:00:00.000Z",
  slot_minutes: 30,
  timezone: "Europe/London",
  status: "booked",
};

beforeEach(() => {
  mockRequireUserId.mockReset();
  mockFetchBookingForRecruiter.mockReset();
  mockRequireUserId.mockResolvedValue("user-1");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getInterviewBooking", () => {
  it("rejects unauthenticated callers before querying", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getInterviewBooking(VALID_APP_ID)).rejects.toThrow("Unauthorized");

    expect(mockFetchBookingForRecruiter).not.toHaveBeenCalled();
  });

  it("rejects an applicationId that is not a uuid", async () => {
    await expect(getInterviewBooking("not-a-uuid")).rejects.toThrow();

    expect(mockFetchBookingForRecruiter).not.toHaveBeenCalled();
  });

  it("returns the booking for the application from the data layer", async () => {
    mockFetchBookingForRecruiter.mockResolvedValueOnce(BOOKING);

    const result = await getInterviewBooking(VALID_APP_ID);

    expect(mockFetchBookingForRecruiter).toHaveBeenCalledWith(VALID_APP_ID);
    expect(result).toEqual(BOOKING);
  });

  it("returns null when the candidate has not booked", async () => {
    mockFetchBookingForRecruiter.mockResolvedValueOnce(null);

    expect(await getInterviewBooking(VALID_APP_ID)).toBeNull();
  });
});
