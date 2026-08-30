import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_APP_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";
const VALID_CANDIDATE_ID = "770e8400-e29b-41d4-a716-446655440002";
const VALID_ENTRY_ID = "880e8400-e29b-41d4-a716-446655440003";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockFetchCandidateById,
  mockUpsertEntry,
  mockUpdateEntry,
  mockDeleteEntry,
  mockFetchEntries,
  mockFetchEvidence,
  mockFetchPooledIds,
  mockFetchEntryByCandidate,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockUpsertEntry: vi.fn(),
  mockUpdateEntry: vi.fn(),
  mockDeleteEntry: vi.fn(),
  mockFetchEntries: vi.fn(),
  mockFetchEvidence: vi.fn(),
  mockFetchPooledIds: vi.fn(),
  mockFetchEntryByCandidate: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/data/candidates", () => ({
  fetchCandidateById: mockFetchCandidateById,
}));
vi.mock("@/lib/data/talent-pool-entries", () => ({
  upsertTalentPoolEntry: mockUpsertEntry,
  updateTalentPoolEntry: mockUpdateEntry,
  deleteTalentPoolEntry: mockDeleteEntry,
  fetchTalentPoolEntries: mockFetchEntries,
  fetchPooledCandidateEvidence: mockFetchEvidence,
  fetchPooledCandidateIds: mockFetchPooledIds,
  fetchTalentPoolEntryByCandidate: mockFetchEntryByCandidate,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import {
  addToTalentPool,
  getCandidatePoolState,
  getCuratedTalentPool,
  removeFromTalentPool,
  updateTalentPoolCuration,
} from "./talent-pool";

function poolRow(id: string, candidateId: string) {
  return {
    id,
    candidate_id: candidateId,
    source_application_id: VALID_APP_ID,
    source_campaign_id: VALID_CAMPAIGN_ID,
    tags: ["react"],
    notes: null,
    added_at: "2026-08-10T09:00:00.000Z",
    candidates: {
      id: candidateId,
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: null,
      location: null,
    },
    campaigns: { id: VALID_CAMPAIGN_ID, title: "Backend Engineer" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchCandidateById.mockResolvedValue({
    id: VALID_APP_ID,
    campaign_id: VALID_CAMPAIGN_ID,
    candidate_id: VALID_CANDIDATE_ID,
    status: "rejected",
  });
  mockUpsertEntry.mockResolvedValue({ id: VALID_ENTRY_ID });
  mockUpdateEntry.mockResolvedValue(undefined);
  mockDeleteEntry.mockResolvedValue(undefined);
  mockFetchEntries.mockResolvedValue([]);
  mockFetchEvidence.mockResolvedValue([]);
  mockFetchPooledIds.mockResolvedValue([]);
  mockFetchEntryByCandidate.mockResolvedValue(null);
});

describe("addToTalentPool", () => {
  it("rejects unauthenticated callers before touching the pool", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(addToTalentPool({ applicationId: VALID_APP_ID })).rejects.toThrow(
      "Unauthorized",
    );
    expect(mockUpsertEntry).not.toHaveBeenCalled();
  });

  it("rejects a malformed application id", async () => {
    await expect(addToTalentPool({ applicationId: "not-a-uuid" })).rejects.toThrow();
    expect(mockUpsertEntry).not.toHaveBeenCalled();
  });

  /**
   * `fetchCandidateById` is scoped to the recruiter's own campaigns, so a
   * crafted id must not become a pool entry pointing at a stranger.
   */
  it("refuses to pool an application the recruiter cannot see", async () => {
    mockFetchCandidateById.mockResolvedValueOnce(null);

    await expect(addToTalentPool({ applicationId: VALID_APP_ID })).rejects.toThrow(
      "Application not found",
    );
    expect(mockUpsertEntry).not.toHaveBeenCalled();
  });

  it("records the candidate and the campaign the decision was made in", async () => {
    await addToTalentPool({ applicationId: VALID_APP_ID, notes: "Great culture fit" });

    expect(mockUpsertEntry).toHaveBeenCalledWith("user-1", {
      candidateId: VALID_CANDIDATE_ID,
      sourceApplicationId: VALID_APP_ID,
      sourceCampaignId: VALID_CAMPAIGN_ID,
      tags: [],
      notes: "Great culture fit",
    });
  });

  it("normalizes tags before storing them", async () => {
    await addToTalentPool({
      applicationId: VALID_APP_ID,
      tags: ["  React ", "react", "", "Senior"],
    });

    expect(mockUpsertEntry.mock.calls[0][1].tags).toEqual(["React", "Senior"]);
  });

  it("stores an empty note as null rather than an empty string", async () => {
    // An empty string would render as an annotated entry with nothing in it.
    await addToTalentPool({ applicationId: VALID_APP_ID, notes: "   " });

    expect(mockUpsertEntry.mock.calls[0][1].notes).toBeNull();
  });

  it("rejects more tags than the pool allows", async () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => `tag-${i}`);

    await expect(
      addToTalentPool({ applicationId: VALID_APP_ID, tags: tooMany }),
    ).rejects.toThrow();
    expect(mockUpsertEntry).not.toHaveBeenCalled();
  });

  it("enforces a rate limit", async () => {
    await addToTalentPool({ applicationId: VALID_APP_ID });

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "talent-pool-add" }),
    );
  });

  it("revalidates both the pool page and the candidate page", async () => {
    await addToTalentPool({ applicationId: VALID_APP_ID });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/candidates");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}/candidates/${VALID_APP_ID}`,
    );
  });
});

describe("updateTalentPoolCuration", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      updateTalentPoolCuration({ entryId: VALID_ENTRY_ID }),
    ).rejects.toThrow("Unauthorized");
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });

  it("rejects a malformed entry id", async () => {
    await expect(updateTalentPoolCuration({ entryId: "nope" })).rejects.toThrow();
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });

  it("scopes the update to the caller", async () => {
    await updateTalentPoolCuration({
      entryId: VALID_ENTRY_ID,
      tags: ["golang"],
      notes: "Revisit for the platform role",
    });

    expect(mockUpdateEntry).toHaveBeenCalledWith("user-1", VALID_ENTRY_ID, {
      tags: ["golang"],
      notes: "Revisit for the platform role",
    });
  });

  it("clears a note back to null when emptied", async () => {
    await updateTalentPoolCuration({ entryId: VALID_ENTRY_ID, notes: "" });

    expect(mockUpdateEntry.mock.calls[0][2].notes).toBeNull();
  });
});

describe("removeFromTalentPool", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(removeFromTalentPool(VALID_ENTRY_ID)).rejects.toThrow("Unauthorized");
    expect(mockDeleteEntry).not.toHaveBeenCalled();
  });

  it("rejects a malformed entry id", async () => {
    await expect(removeFromTalentPool("nope")).rejects.toThrow();
    expect(mockDeleteEntry).not.toHaveBeenCalled();
  });

  it("scopes the delete to the caller", async () => {
    await removeFromTalentPool(VALID_ENTRY_ID);

    expect(mockDeleteEntry).toHaveBeenCalledWith("user-1", VALID_ENTRY_ID);
  });
});

describe("getCuratedTalentPool", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getCuratedTalentPool()).rejects.toThrow("Unauthorized");
    expect(mockFetchEntries).not.toHaveBeenCalled();
  });

  it("skips the evidence query entirely for an empty pool", async () => {
    const result = await getCuratedTalentPool();

    expect(result).toEqual([]);
    expect(mockFetchEvidence).not.toHaveBeenCalled();
  });

  it("asks for each pooled person's evidence exactly once", async () => {
    // Two entries can never share a candidate (the table is unique on it), but
    // the de-dupe protects the IN(...) list from a stale duplicate anyway.
    mockFetchEntries.mockResolvedValue([
      poolRow("entry-1", VALID_CANDIDATE_ID),
      poolRow("entry-2", VALID_CANDIDATE_ID),
    ]);

    await getCuratedTalentPool();

    expect(mockFetchEvidence).toHaveBeenCalledWith("user-1", [VALID_CANDIDATE_ID]);
  });

  it("returns composed entries carrying their curation", async () => {
    mockFetchEntries.mockResolvedValue([poolRow("entry-1", VALID_CANDIDATE_ID)]);
    mockFetchEvidence.mockResolvedValue([
      {
        candidate_id: VALID_CANDIDATE_ID,
        campaign_id: VALID_CAMPAIGN_ID,
        created_at: "2026-08-01T09:00:00.000Z",
        resume_score: 88,
        parsed_data: null,
        campaigns: { id: VALID_CAMPAIGN_ID, title: "Backend Engineer" },
      },
    ]);

    const result = await getCuratedTalentPool();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "entry-1",
      name: "Ada Lovelace",
      tags: ["react"],
      bestScore: 88,
    });
  });
});

describe("getCandidatePoolState", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getCandidatePoolState(VALID_APP_ID)).rejects.toThrow("Unauthorized");
  });

  it("reports not-pooled for a malformed id without querying", async () => {
    const result = await getCandidatePoolState("nope");

    expect(result.pooled).toBe(false);
    expect(mockFetchEntryByCandidate).not.toHaveBeenCalled();
  });

  it("reports not-pooled when the candidate has no entry", async () => {
    const result = await getCandidatePoolState(VALID_APP_ID);

    expect(result).toEqual({ pooled: false, entryId: null, tags: [], notes: "" });
  });

  it("returns the existing curation so the editor opens pre-filled", async () => {
    mockFetchEntryByCandidate.mockResolvedValue({
      id: VALID_ENTRY_ID,
      tags: ["react"],
      notes: "Second choice for the backend role",
      added_at: "2026-08-10T09:00:00.000Z",
    });

    const result = await getCandidatePoolState(VALID_APP_ID);

    expect(result).toEqual({
      pooled: true,
      entryId: VALID_ENTRY_ID,
      tags: ["react"],
      notes: "Second choice for the backend role",
    });
  });
});
