import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUserId, mockFetchCampaignScoringConfig } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchCampaignScoringConfig: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/data/campaigns", () => ({
  fetchAllCampaigns: vi.fn(),
  fetchCampaignById: vi.fn(),
  insertCampaignTx: vi.fn(),
  updateCampaignTx: vi.fn(),
  cloneCampaignTx: vi.fn(),
  fetchCampaignScoringConfig: mockFetchCampaignScoringConfig,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { getResumeCriteriaCount } from "./campaigns";

const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
});

describe("getResumeCriteriaCount", () => {
  it("rejects unauthenticated callers before querying", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).rejects.toThrow("Unauthorized");
    expect(mockFetchCampaignScoringConfig).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id (uuid format)", async () => {
    await expect(getResumeCriteriaCount("not-a-uuid")).rejects.toThrow();
    expect(mockFetchCampaignScoringConfig).not.toHaveBeenCalled();
  });

  it("returns 0 when the campaign has no scoring config", async () => {
    mockFetchCampaignScoringConfig.mockResolvedValue(null);

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).resolves.toBe(0);
  });

  it("returns 0 when the config exists but has no criteria", async () => {
    mockFetchCampaignScoringConfig.mockResolvedValue({ screening_criteria: [] });

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).resolves.toBe(0);
  });

  it("returns the number of screening criteria when configured", async () => {
    mockFetchCampaignScoringConfig.mockResolvedValue({
      screening_criteria: [{ label: "a" }, { label: "b" }, { label: "c" }],
    });

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).resolves.toBe(3);
  });
});
