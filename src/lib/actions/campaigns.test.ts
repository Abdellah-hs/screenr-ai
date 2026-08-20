import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockInsertCampaignTx,
  mockFetchCampaignScoringConfig,
  mockFetchCampaignStatus,
  mockUpdateCampaignStatusTx,
  mockSoftDeleteCampaignTx,
  mockRestoreCampaignTx,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockInsertCampaignTx: vi.fn(),
  mockFetchCampaignScoringConfig: vi.fn(),
  mockFetchCampaignStatus: vi.fn(),
  mockUpdateCampaignStatusTx: vi.fn(),
  mockSoftDeleteCampaignTx: vi.fn(),
  mockRestoreCampaignTx: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/data/campaigns", () => ({
  fetchAllCampaigns: vi.fn(),
  fetchCampaignById: vi.fn(),
  insertCampaignTx: mockInsertCampaignTx,
  updateCampaignTx: vi.fn(),
  cloneCampaignTx: vi.fn(),
  fetchCampaignScoringConfig: mockFetchCampaignScoringConfig,
  fetchCampaignStatus: mockFetchCampaignStatus,
  updateCampaignStatusTx: mockUpdateCampaignStatusTx,
  softDeleteCampaignTx: mockSoftDeleteCampaignTx,
  restoreCampaignTx: mockRestoreCampaignTx,
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
  createCampaign,
  getCampaignById,
  getResumeCriteriaCount,
  updateCampaignStatus,
  deleteCampaign,
  deleteCampaigns,
  updateCampaignsStatus,
  restoreCampaign,
} from "./campaigns";
import { fetchCampaignById } from "@/lib/data/campaigns";

const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";
const VALID_CAMPAIGN_ID_2 = "770e8400-e29b-41d4-a716-446655440002";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
});

describe("getCampaignById", () => {
  it("returns null for a malformed id without querying the database", async () => {
    // e.g. a literal /campaigns/undefined URL — must not reach Supabase.
    await expect(getCampaignById("undefined")).resolves.toBeNull();
    expect(vi.mocked(fetchCampaignById)).not.toHaveBeenCalled();
  });

  it("delegates to fetchCampaignById for a valid uuid", async () => {
    vi.mocked(fetchCampaignById).mockResolvedValue({ id: VALID_CAMPAIGN_ID } as never);

    await expect(getCampaignById(VALID_CAMPAIGN_ID)).resolves.toEqual({
      id: VALID_CAMPAIGN_ID,
    });
    expect(vi.mocked(fetchCampaignById)).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
  });
});

describe("restoreCampaign", () => {
  it("rejects unauthenticated callers before restoring", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(restoreCampaign(VALID_CAMPAIGN_ID)).rejects.toThrow("Unauthorized");
    expect(mockRestoreCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects a malformed campaign id before touching the data layer", async () => {
    await expect(restoreCampaign("not-a-uuid")).rejects.toThrow();
    expect(mockRestoreCampaignTx).not.toHaveBeenCalled();
  });

  it("restores the owned campaign and revalidates the pool + list", async () => {
    mockRestoreCampaignTx.mockResolvedValue(undefined);

    await restoreCampaign(VALID_CAMPAIGN_ID);

    expect(mockRestoreCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/candidates");
  });
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
      true,
    );
  });

  it("decodes 'active_no_intake' to active + intake closed", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "active_no_intake");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "active",
      "user-1",
      false,
    );
  });

  it("persists the change and revalidates the campaign subtree and list", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "active");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "active",
      "user-1",
      true,
    );
    // "layout" so the candidate detail pages under the campaign (whose
    // controls are freeze-gated on this status) refresh too.
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}`,
      "layout",
    );
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

  it("revalidates each selected campaign's subtree", async () => {
    mockFetchCampaignStatus
      .mockResolvedValueOnce("draft")
      .mockResolvedValueOnce("active");

    await updateCampaignsStatus([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2], "paused");

    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}`,
      "layout",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID_2}`,
      "layout",
    );
  });
});

describe("createCampaign — team reviewers flag", () => {
  const FLAG = "NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS";

  /** The minimum a campaign form must carry, plus a reviewer payload. */
  function formWithReviewers(): FormData {
    const form = new FormData();
    form.set("title", "Senior Engineer");
    form.set("status", "draft");
    form.set(
      "reviewers_json",
      JSON.stringify([{ user_id: "user-temp-1730000000000", role: "reviewer" }]),
    );
    return form;
  }

  beforeEach(() => {
    delete process.env[FLAG];
    mockInsertCampaignTx.mockResolvedValue(VALID_CAMPAIGN_ID);
  });

  /**
   * Hiding the editor only removes the hidden input. This is the half that
   * makes the flag mean something: a hand-built post must not seed the table
   * with placeholder identities that grant nothing and read as real.
   */
  it("drops reviewers from a submitted form while the flag is off", async () => {
    await createCampaign(formWithReviewers());

    expect(mockInsertCampaignTx).toHaveBeenCalledTimes(1);
    expect(mockInsertCampaignTx.mock.calls[0][3]).toEqual([]);
  });

  it("writes reviewers once the flag is on", async () => {
    process.env[FLAG] = "true";

    await createCampaign(formWithReviewers());

    expect(mockInsertCampaignTx.mock.calls[0][3]).toEqual([
      { user_id: "user-temp-1730000000000", role: "reviewer" },
    ]);
  });

  it("still creates the campaign — the flag gates reviewers, not the form", async () => {
    await createCampaign(formWithReviewers());

    expect(mockInsertCampaignTx.mock.calls[0][0]).toMatchObject({
      title: "Senior Engineer",
    });
  });
});
