import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_FLAG_ID = "550e8400-e29b-41d4-a716-446655440000";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockFetchQueue,
  mockFetchFlagById,
  mockResolveFlag,
  mockMergeCandidates,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchQueue: vi.fn(),
  mockFetchFlagById: vi.fn(),
  mockResolveFlag: vi.fn(),
  mockMergeCandidates: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/data/duplicate-flags", () => ({
  fetchOpenDuplicateFlagsWithCandidates: mockFetchQueue,
  fetchDuplicateFlagById: mockFetchFlagById,
  resolveDuplicateFlag: mockResolveFlag,
  mergeCandidatesTx: mockMergeCandidates,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { getDuplicateReviewQueue, resolveDuplicateFlagAction } from "./duplicates";

const OPEN_FLAG = {
  id: VALID_FLAG_ID,
  candidate_id: "cand-new",
  matched_candidate_id: "cand-existing",
  match_signals: { email_match: true },
  status: "open",
  reviewer_user_id: null,
  rationale: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  resolved_at: null,
};

beforeEach(() => {
  mockRequireUserId.mockReset();
  mockCheckRateLimit.mockReset();
  mockFetchQueue.mockReset();
  mockFetchFlagById.mockReset();
  mockResolveFlag.mockReset();
  mockMergeCandidates.mockReset();
  mockRevalidatePath.mockReset();

  mockRequireUserId.mockResolvedValue("hr-user-1");
  mockFetchFlagById.mockResolvedValue(OPEN_FLAG);
  mockResolveFlag.mockResolvedValue(undefined);
  mockMergeCandidates.mockResolvedValue(undefined);
  mockFetchQueue.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getDuplicateReviewQueue", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getDuplicateReviewQueue()).rejects.toThrow("Unauthorized");
    expect(mockFetchQueue).not.toHaveBeenCalled();
  });

  it("returns the enriched open-flag queue for an authenticated user", async () => {
    const queue = [{ flag: OPEN_FLAG, candidate: {}, matched: {} }];
    mockFetchQueue.mockResolvedValueOnce(queue);

    await expect(getDuplicateReviewQueue()).resolves.toBe(queue);
  });
});

describe("resolveDuplicateFlagAction", () => {
  const approve = {
    flagId: VALID_FLAG_ID,
    decision: "approved" as const,
    rationale: "Same person — two intake channels.",
  };

  it("rejects unauthenticated callers before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(resolveDuplicateFlagAction(approve)).rejects.toThrow("Unauthorized");
    expect(mockResolveFlag).not.toHaveBeenCalled();
    expect(mockMergeCandidates).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID flagId", async () => {
    await expect(
      resolveDuplicateFlagAction({ ...approve, flagId: "not-a-uuid" }),
    ).rejects.toThrow();
    expect(mockResolveFlag).not.toHaveBeenCalled();
  });

  it("rejects a decision outside approved/rejected", async () => {
    await expect(
      // @ts-expect-error — exercising runtime validation of an illegal enum
      resolveDuplicateFlagAction({ ...approve, decision: "maybe" }),
    ).rejects.toThrow();
    expect(mockResolveFlag).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace-only rationale", async () => {
    await expect(
      resolveDuplicateFlagAction({ ...approve, rationale: "   " }),
    ).rejects.toThrow();
    expect(mockResolveFlag).not.toHaveBeenCalled();
  });

  it("throws when the flag does not exist", async () => {
    mockFetchFlagById.mockResolvedValueOnce(null);

    await expect(resolveDuplicateFlagAction(approve)).rejects.toThrow("not found");
    expect(mockResolveFlag).not.toHaveBeenCalled();
  });

  it("throws when the flag has already been reviewed", async () => {
    mockFetchFlagById.mockResolvedValueOnce({ ...OPEN_FLAG, status: "approved" });

    await expect(resolveDuplicateFlagAction(approve)).rejects.toThrow(
      "already been reviewed",
    );
    expect(mockResolveFlag).not.toHaveBeenCalled();
    expect(mockMergeCandidates).not.toHaveBeenCalled();
  });

  it("on approve: merges the new candidate into the existing one, then resolves the flag", async () => {
    await resolveDuplicateFlagAction(approve);

    expect(mockMergeCandidates).toHaveBeenCalledWith("cand-new", "cand-existing");
    expect(mockResolveFlag).toHaveBeenCalledWith(
      expect.objectContaining({
        flagId: VALID_FLAG_ID,
        decision: "approved",
        reviewerUserId: "hr-user-1",
      }),
    );
  });

  it("on reject: resolves the flag without merging anything", async () => {
    await resolveDuplicateFlagAction({ ...approve, decision: "rejected" });

    expect(mockMergeCandidates).not.toHaveBeenCalled();
    expect(mockResolveFlag).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "rejected" }),
    );
  });
});
