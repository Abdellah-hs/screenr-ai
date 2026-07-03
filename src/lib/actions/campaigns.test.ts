import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockFetchCampaignScoringConfig,
  mockFetchCampaignStatus,
  mockUpdateCampaignStatusTx,
  mockSoftDeleteCampaignTx,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchCampaignScoringConfig: vi.fn(),
  mockFetchCampaignStatus: vi.fn(),
  mockUpdateCampaignStatusTx: vi.fn(),
  mockSoftDeleteCampaignTx: vi.fn(),
  mockRevalidatePath: vi.fn(),
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
  fetchCampaignStatus: mockFetchCampaignStatus,
  updateCampaignStatusTx: mockUpdateCampaignStatusTx,
  softDeleteCampaignTx: mockSoftDeleteCampaignTx,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

// updateCampaign delegates post-save scoring to this action. Mock it so importing
// campaigns.ts doesn't pull in the real candidates module (which instantiates an
// OpenAI client at load via the screening-questions service).
vi.mock("./candidates", () => ({
  scoreUnscoredCampaignCandidates: vi.fn(),
}));

import {
  getResumeCriteriaCount,
  updateCampaignStatus,
  deleteCampaign,
  deleteCampaigns,
  updateCampaignsStatus,
} from "./campaigns";

const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";
const VALID_CAMPAIGN_ID_2 = "770e8400-e29b-41d4-a716-446655440002";

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

describe("updateCampaignStatus", () => {
  it("rejects unauthenticated callers before reading anything", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(updateCampaignStatus(VALID_CAMPAIGN_ID, "active")).rejects.toThrow(
      "Unauthorized",
    );
    expect(mockFetchCampaignStatus).not.toHaveBeenCalled();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id", async () => {
    await expect(updateCampaignStatus("not-a-uuid", "active")).rejects.toThrow();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value", async () => {
    await expect(
      updateCampaignStatus(VALID_CAMPAIGN_ID, "bogus" as never),
    ).rejects.toThrow();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("throws when the campaign is missing or not owned", async () => {
    mockFetchCampaignStatus.mockResolvedValue(null);

    await expect(updateCampaignStatus(VALID_CAMPAIGN_ID, "active")).rejects.toThrow(
      "Campaign not found",
    );
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("sets any status freely, including formerly-restricted moves (draft → paused)", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "paused");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "paused",
      "user-1",
    );
  });

  it("persists the change and revalidates the campaign pages", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "active");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "active",
      "user-1",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/campaigns/${VALID_CAMPAIGN_ID}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});

describe("deleteCampaign", () => {
  it("rejects unauthenticated callers before deleting", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(deleteCampaign(VALID_CAMPAIGN_ID)).rejects.toThrow("Unauthorized");
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id", async () => {
    await expect(deleteCampaign("not-a-uuid")).rejects.toThrow();
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("soft-deletes the campaign and revalidates the list", async () => {
    await deleteCampaign(VALID_CAMPAIGN_ID);

    expect(mockSoftDeleteCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});

describe("deleteCampaigns (bulk)", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(deleteCampaigns([VALID_CAMPAIGN_ID])).rejects.toThrow("Unauthorized");
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    await expect(deleteCampaigns([])).rejects.toThrow();
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects when any id is not a uuid", async () => {
    await expect(deleteCampaigns([VALID_CAMPAIGN_ID, "nope"])).rejects.toThrow();
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("soft-deletes each selected campaign and revalidates once", async () => {
    await deleteCampaigns([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2]);

    expect(mockSoftDeleteCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
    expect(mockSoftDeleteCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID_2, "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});

describe("updateCampaignsStatus (bulk)", () => {
  it("rejects an invalid target status", async () => {
    await expect(
      updateCampaignsStatus([VALID_CAMPAIGN_ID], "bogus" as never),
    ).rejects.toThrow();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("rejects the whole batch (no writes) when a campaign is missing or not owned", async () => {
    mockFetchCampaignStatus
      .mockResolvedValueOnce("active")
      .mockResolvedValueOnce(null);

    await expect(
      updateCampaignsStatus([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2], "paused"),
    ).rejects.toThrow("Campaign not found");
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("sets a status across a mixed selection (draft + active → closed)", async () => {
    mockFetchCampaignStatus
      .mockResolvedValueOnce("draft")
      .mockResolvedValueOnce("active");

    await updateCampaignsStatus([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2], "closed");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "closed",
      "user-1",
    );
    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID_2,
      "active",
      "closed",
      "user-1",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});
