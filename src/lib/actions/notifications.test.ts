import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireUserId,
  mockFetchReviews,
  mockFetchBreaches,
  mockFetchExpired,
  mockFetchAwaiting,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchReviews: vi.fn(),
  mockFetchBreaches: vi.fn(),
  mockFetchExpired: vi.fn(),
  mockFetchAwaiting: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/data/notifications", () => ({
  fetchPendingReviewNotifications: mockFetchReviews,
  fetchSlaBreachNotifications: mockFetchBreaches,
  fetchExpiredInterviewNotifications: mockFetchExpired,
  fetchAwaitingDecisionNotifications: mockFetchAwaiting,
}));

import { getRecruiterNotifications } from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchReviews.mockResolvedValue([]);
  mockFetchBreaches.mockResolvedValue([]);
  mockFetchExpired.mockResolvedValue([]);
  mockFetchAwaiting.mockResolvedValue([]);
});

describe("getRecruiterNotifications", () => {
  it("rejects unauthenticated callers before querying", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getRecruiterNotifications()).rejects.toThrow("Unauthorized");
    expect(mockFetchReviews).not.toHaveBeenCalled();
    expect(mockFetchBreaches).not.toHaveBeenCalled();
  });

  it("maps pending reviews to bell items with a stable id", async () => {
    mockFetchReviews.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", pending_review_count: 3 },
    ]);

    const result = await getRecruiterNotifications();

    expect(result).toEqual([
      {
        id: "review:c1",
        kind: "pending_review",
        campaignId: "c1",
        campaignTitle: "AI Engineer",
        count: 3,
      },
    ]);
  });

  it("surfaces SLA breaches above pending reviews", async () => {
    mockFetchReviews.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", pending_review_count: 2 },
    ]);
    mockFetchBreaches.mockResolvedValue([
      {
        campaign_id: "c1",
        campaign_title: "AI Engineer",
        stage: "screening",
        stage_label: "Screening",
        level: "escalation",
        count: 4,
      },
    ]);

    const result = await getRecruiterNotifications();

    expect(result.map((n) => n.kind)).toEqual(["sla_breach", "pending_review"]);
    expect(result[0]).toEqual({
      id: "sla:c1:screening",
      kind: "sla_breach",
      campaignId: "c1",
      campaignTitle: "AI Engineer",
      count: 4,
      // The machine-readable stage rides alongside the label so the bell can
      // deep-link into the filtered table; the label alone is display copy.
      stage: "screening",
      stageLabel: "Screening",
      level: "escalation",
    });
  });

  /**
   * An expired interview is the one pipeline exit with no human in the loop —
   * the sweep moves the application out of the funnel and, without this, nothing
   * ever tells the recruiter their candidate lapsed.
   */
  it("surfaces expired interviews as their own bell item", async () => {
    mockFetchExpired.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", expired_count: 2 },
    ]);

    const result = await getRecruiterNotifications();

    expect(result).toEqual([
      {
        id: "interview-expired:c1",
        kind: "interview_expired",
        campaignId: "c1",
        campaignTitle: "AI Engineer",
        count: 2,
      },
    ]);
  });

  it("ranks expired interviews below SLA breaches but above review reminders", async () => {
    // A review is waiting on the recruiter; an expiry already happened without
    // them. Neither is as urgent as a live SLA breach.
    mockFetchReviews.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", pending_review_count: 2 },
    ]);
    mockFetchBreaches.mockResolvedValue([
      {
        campaign_id: "c1",
        campaign_title: "AI Engineer",
        stage: "screening",
        stage_label: "Screening",
        level: "alert",
        count: 1,
      },
    ]);
    mockFetchExpired.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", expired_count: 3 },
    ]);

    const result = await getRecruiterNotifications();

    expect(result.map((n) => n.kind)).toEqual([
      "sla_breach",
      "interview_expired",
      "pending_review",
    ]);
  });

  /**
   * A scored interview used to send no signal in either automation mode, so a
   * candidate who had done everything asked of them could wait indefinitely
   * with nobody aware they were the bottleneck.
   */
  it("surfaces interviewed candidates waiting on a decision", async () => {
    mockFetchAwaiting.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", awaiting_count: 3 },
    ]);

    const result = await getRecruiterNotifications();

    expect(result).toEqual([
      {
        id: "awaiting-decision:c1",
        kind: "awaiting_decision",
        campaignId: "c1",
        campaignTitle: "AI Engineer",
        count: 3,
      },
    ]);
  });

  it("ranks decisions last — nothing is decaying, but someone is waiting on us", async () => {
    mockFetchBreaches.mockResolvedValue([
      {
        campaign_id: "c1",
        campaign_title: "AI Engineer",
        stage: "screening",
        stage_label: "Screening",
        level: "alert",
        count: 1,
      },
    ]);
    mockFetchAwaiting.mockResolvedValue([
      { campaign_id: "c1", campaign_title: "AI Engineer", awaiting_count: 2 },
    ]);

    const result = await getRecruiterNotifications();

    expect(result.map((n) => n.kind)).toEqual(["sla_breach", "awaiting_decision"]);
  });
});
