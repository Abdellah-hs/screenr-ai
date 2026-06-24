import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireUserId, mockFetchReviews, mockFetchBreaches } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchReviews: vi.fn(),
  mockFetchBreaches: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/data/notifications", () => ({
  fetchPendingReviewNotifications: mockFetchReviews,
  fetchSlaBreachNotifications: mockFetchBreaches,
}));

import { getRecruiterNotifications } from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchReviews.mockResolvedValue([]);
  mockFetchBreaches.mockResolvedValue([]);
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
      stageLabel: "Screening",
      level: "escalation",
    });
  });
});
