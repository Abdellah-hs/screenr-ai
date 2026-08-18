import { describe, it, expect, vi, beforeEach } from "vitest";

// from("applications").select(...).eq("status",…).eq("campaigns.user_id",…).is("campaigns.deleted_at", null)
const mockIs = vi.fn();
const mockEqUser = vi.fn(() => ({ is: mockIs }));
const mockEqStatus = vi.fn(() => ({ eq: mockEqUser }));
const mockSelect = vi.fn(() => ({ eq: mockEqStatus }));
// Return type widened so the SLA describe can override with table-specific chains.
const mockFrom = vi.fn((): Record<string, unknown> => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

import {
  fetchExpiredInterviewNotifications,
  fetchPendingReviewNotifications,
  fetchSlaBreachNotifications,
} from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPendingReviewNotifications", () => {
  it("groups pending reviews per campaign with counts, busiest first", async () => {
    mockIs.mockResolvedValue({
      data: [
        { campaign_id: "c2", campaigns: { title: "Designer" } },
        { campaign_id: "c1", campaigns: { title: "AI Engineer" } },
        { campaign_id: "c1", campaigns: { title: "AI Engineer" } },
        { campaign_id: "c1", campaigns: { title: "AI Engineer" } },
      ],
      error: null,
    });

    const result = await fetchPendingReviewNotifications("user-1");

    expect(result).toEqual([
      { campaign_id: "c1", campaign_title: "AI Engineer", pending_review_count: 3 },
      { campaign_id: "c2", campaign_title: "Designer", pending_review_count: 1 },
    ]);
    expect(mockEqStatus).toHaveBeenCalledWith("status", "screening_review_pending");
    expect(mockEqUser).toHaveBeenCalledWith("campaigns.user_id", "user-1");
  });

  it("returns an empty list when there are no pending reviews", async () => {
    mockIs.mockResolvedValue({ data: [], error: null });

    expect(await fetchPendingReviewNotifications("user-1")).toEqual([]);
  });

  it("returns an empty list on a query error rather than throwing", async () => {
    mockIs.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await fetchPendingReviewNotifications("user-1")).toEqual([]);
  });
});

describe("fetchExpiredInterviewNotifications", () => {
  it("groups expired interviews per campaign with counts, busiest first", async () => {
    mockIs.mockResolvedValue({
      data: [
        { campaign_id: "c2", campaigns: { title: "Designer" } },
        { campaign_id: "c1", campaigns: { title: "AI Engineer" } },
        { campaign_id: "c1", campaigns: { title: "AI Engineer" } },
      ],
      error: null,
    });

    const result = await fetchExpiredInterviewNotifications("user-1");

    expect(result).toEqual([
      { campaign_id: "c1", campaign_title: "AI Engineer", expired_count: 2 },
      { campaign_id: "c2", campaign_title: "Designer", expired_count: 1 },
    ]);
  });

  it("reads exactly the interview_expired state, scoped to the owner", async () => {
    mockIs.mockResolvedValue({ data: [], error: null });

    await fetchExpiredInterviewNotifications("user-1");

    expect(mockEqStatus).toHaveBeenCalledWith("status", "interview_expired");
    expect(mockEqUser).toHaveBeenCalledWith("campaigns.user_id", "user-1");
  });

  it("returns an empty list on a query error rather than throwing", async () => {
    // The bell must degrade to "nothing to show", never take the navbar down.
    mockIs.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await fetchExpiredInterviewNotifications("user-1")).toEqual([]);
  });
});

// Kept last: overrides mockFrom with table-specific chains (sla_timers + applications).
describe("fetchSlaBreachNotifications", () => {
  const timerIs = vi.fn(); // terminal of the sla_timers query
  const appsIn = vi.fn(); // terminal of the applications query

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "sla_timers") {
        return { select: () => ({ eq: () => ({ eq: () => ({ is: timerIs }) }) }) };
      }
      return { select: () => ({ in: appsIn }) }; // applications
    });
  });

  it("flags candidates over SLA, grouped per stage with the worst level", async () => {
    timerIs.mockResolvedValue({
      data: [
        {
          campaign_id: "c1",
          stage: "screening",
          time_limit_hours: 48,
          alert_threshold_hours: 36,
          escalation_threshold_hours: 44,
          campaigns: { title: "AI Engineer" },
        },
      ],
      error: null,
    });
    // ~84h before `now` → past the 44h escalation threshold.
    const stale = "2026-06-20T00:00:00.000Z";
    appsIn.mockResolvedValue({
      data: [
        { status: "screening_sent", updated_at: stale, campaign_id: "c1" },
        { status: "screening_scored", updated_at: stale, campaign_id: "c1" },
        { status: "hired", updated_at: stale, campaign_id: "c1" }, // terminal — ignored
      ],
    });

    const now = new Date("2026-06-23T12:00:00.000Z");
    const result = await fetchSlaBreachNotifications("user-1", now);

    expect(result).toEqual([
      {
        campaign_id: "c1",
        campaign_title: "AI Engineer",
        stage: "screening",
        stage_label: "Screening",
        level: "escalation",
        count: 2,
      },
    ]);
  });

  it("ignores candidates still within their SLA", async () => {
    timerIs.mockResolvedValue({
      data: [
        {
          campaign_id: "c1",
          stage: "screening",
          time_limit_hours: 48,
          alert_threshold_hours: 36,
          escalation_threshold_hours: 44,
          campaigns: { title: "AI Engineer" },
        },
      ],
      error: null,
    });
    const recent = "2026-06-23T06:00:00.000Z"; // 6h before now — well under 36h alert
    appsIn.mockResolvedValue({
      data: [{ status: "screening_sent", updated_at: recent, campaign_id: "c1" }],
    });

    const result = await fetchSlaBreachNotifications("user-1", new Date("2026-06-23T12:00:00.000Z"));

    expect(result).toEqual([]);
  });

  it("returns [] when no campaigns have SLA timers configured", async () => {
    timerIs.mockResolvedValue({ data: [], error: null });

    expect(await fetchSlaBreachNotifications("user-1")).toEqual([]);
  });
});
