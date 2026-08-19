import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_APP_ID = "550e8400-e29b-41d4-a716-446655440000";

const {
  mockRequireUserId,
  mockFetchCandidateById,
  mockFetchApplicationTimeline,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockFetchApplicationTimeline: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/data/candidates", () => ({
  fetchCandidateById: mockFetchCandidateById,
}));
vi.mock("@/lib/data/transitions", () => ({
  fetchApplicationTimeline: mockFetchApplicationTimeline,
}));

import { getCandidateTimeline } from "./timeline";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchCandidateById.mockResolvedValue({ id: VALID_APP_ID, campaign_id: "camp-1" });
  mockFetchApplicationTimeline.mockResolvedValue([]);
});

describe("getCandidateTimeline", () => {
  it("rejects unauthenticated callers before reading any history", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getCandidateTimeline(VALID_APP_ID)).rejects.toThrow("Unauthorized");
    expect(mockFetchApplicationTimeline).not.toHaveBeenCalled();
  });

  it("returns an empty timeline for a malformed id without querying", async () => {
    const result = await getCandidateTimeline("not-a-uuid");

    expect(result).toEqual({ entries: [], hoursInCurrentState: null });
    expect(mockFetchCandidateById).not.toHaveBeenCalled();
  });

  /**
   * `fetchCandidateById` is scoped to the recruiter's own campaigns, so a
   * crafted id must not return somebody else's decision history — which
   * carries their rationales verbatim.
   */
  it("returns nothing for an application the recruiter cannot see", async () => {
    mockFetchCandidateById.mockResolvedValueOnce(null);

    const result = await getCandidateTimeline(VALID_APP_ID);

    expect(result.entries).toEqual([]);
    expect(mockFetchApplicationTimeline).not.toHaveBeenCalled();
  });

  it("builds the timeline from the log rows", async () => {
    mockFetchApplicationTimeline.mockResolvedValue([
      {
        id: "t-1",
        from_state: "new",
        to_state: "screening_approved",
        actor: "system",
        rationale: "Resume score 78 >= threshold 60",
        disposition_code: null,
        disposition_description: null,
        created_at: "2026-08-01T09:00:00.000Z",
      },
      {
        id: "t-2",
        from_state: "screening_approved",
        to_state: "rejected",
        actor: "recruiter",
        rationale: "Not the stack we are hiring for.",
        disposition_code: "OVERRIDE_REJECTED",
        disposition_description: "Not the stack we are hiring for.",
        created_at: "2026-08-02T09:00:00.000Z",
      },
    ]);

    const result = await getCandidateTimeline(VALID_APP_ID);

    expect(result.entries.map((e) => e.id)).toEqual(["t-1", "t-2"]);
    // The override pairing survives the action boundary — the point of the
    // whole feature is that both sides read together.
    expect(result.entries[1].overrides?.toState).toBe("screening_approved");
  });

  it("scopes the history read to the requested application", async () => {
    await getCandidateTimeline(VALID_APP_ID);

    expect(mockFetchApplicationTimeline).toHaveBeenCalledWith(VALID_APP_ID);
  });
});
