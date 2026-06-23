import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchCampaignStatus } = vi.hoisted(() => ({
  mockFetchCampaignStatus: vi.fn(),
}));

vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignStatus: mockFetchCampaignStatus,
}));

import { assertCampaignActiveById } from "./campaign-guards";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertCampaignActiveById", () => {
  it("resolves for an active campaign", async () => {
    mockFetchCampaignStatus.mockResolvedValue("active");

    await expect(assertCampaignActiveById("camp-1", "user-1")).resolves.toBeUndefined();
    expect(mockFetchCampaignStatus).toHaveBeenCalledWith("camp-1", "user-1");
  });

  it("throws (freezing the action) when the campaign isn't active", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await expect(assertCampaignActiveById("camp-1", "user-1")).rejects.toThrow(
      /this campaign is draft/i,
    );
  });

  it("throws when the campaign is missing or not owned", async () => {
    mockFetchCampaignStatus.mockResolvedValue(null);

    await expect(assertCampaignActiveById("camp-1", "user-1")).rejects.toThrow(
      /not found/i,
    );
  });
});
