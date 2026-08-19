import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_A = "550e8400-e29b-41d4-a716-446655440001";
const APP_B = "550e8400-e29b-41d4-a716-446655440002";
const APP_C = "550e8400-e29b-41d4-a716-446655440003";
const CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440000";

const RATIONALE = "Closing out the batch after the hiring sync.";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockFetchCandidateById,
  mockTransitionApplication,
  mockUpsertTalentPoolEntry,
  mockSendTransitionNotification,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockTransitionApplication: vi.fn(),
  mockUpsertTalentPoolEntry: vi.fn(),
  mockSendTransitionNotification: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/data/candidates", () => ({
  fetchCandidateById: mockFetchCandidateById,
}));
vi.mock("@/lib/data/transitions", () => ({
  transitionApplication: mockTransitionApplication,
}));
vi.mock("@/lib/data/talent-pool-entries", () => ({
  upsertTalentPoolEntry: mockUpsertTalentPoolEntry,
}));
vi.mock("@/lib/actions/transition-notifications", () => ({
  sendTransitionNotification: mockSendTransitionNotification,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { bulkCandidateAction } from "./bulk-candidates";

/** Register an application at a given state so `fetchCandidateById` finds it. */
function seed(apps: Record<string, string>) {
  mockFetchCandidateById.mockImplementation(async (id: string) => {
    const status = apps[id];
    if (!status) return null;
    return {
      id,
      campaign_id: CAMPAIGN_ID,
      candidate_id: `cand-${id}`,
      status,
      candidates: { first_name: "Ada", last_name: id.slice(-1), email: "ada@example.com" },
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockTransitionApplication.mockResolvedValue(undefined);
  mockUpsertTalentPoolEntry.mockResolvedValue({ id: "entry-1" });
  mockSendTransitionNotification.mockResolvedValue(undefined);
  seed({ [APP_A]: "screening_scored", [APP_B]: "screening_scored" });
});

describe("bulkCandidateAction — guards", () => {
  it("rejects unauthenticated callers before touching anything", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      bulkCandidateAction({ applicationIds: [APP_A], action: "advance", rationale: RATIONALE }),
    ).rejects.toThrow("Unauthorized");
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    await expect(
      bulkCandidateAction({ applicationIds: [], action: "advance", rationale: RATIONALE }),
    ).rejects.toThrow();
  });

  /**
   * The expensive mistake here is a mis-clicked select-all acting on an entire
   * campaign, and there is no undo for a sent email.
   */
  it("rejects a selection above the batch ceiling", async () => {
    const tooMany = Array.from({ length: 201 }, () => APP_A);

    await expect(
      bulkCandidateAction({ applicationIds: tooMany, action: "advance", rationale: RATIONALE }),
    ).rejects.toThrow();
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("requires a rationale for a state change", async () => {
    await expect(
      bulkCandidateAction({ applicationIds: [APP_A], action: "advance" }),
    ).rejects.toThrow(/reason/i);
  });

  /**
   * Pooling is a bookmark, not a state change — nothing lands in the audit log,
   * so there is no record for a rationale to explain.
   */
  it("does not require a rationale to add people to the talent pool", async () => {
    const result = await bulkCandidateAction({
      applicationIds: [APP_A],
      action: "talent_pool",
    });

    expect(result.succeeded).toBe(1);
  });

  it("rate-limits the batch rather than the individual candidate", async () => {
    await bulkCandidateAction({
      applicationIds: [APP_A, APP_B],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "bulk-candidate-action" }),
    );
  });
});

describe("bulkCandidateAction — advance", () => {
  it("transitions each application individually, never as one update", async () => {
    await bulkCandidateAction({
      applicationIds: [APP_A, APP_B],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(mockTransitionApplication).toHaveBeenCalledTimes(2);
    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP_A,
        toState: "interview_invited",
        actor: "recruiter",
        rationale: RATIONALE,
      }),
    );
  });

  /**
   * The heart of the issue: a mixed-legality batch must transition only the
   * legal ones and report the rest, not silently drop them.
   */
  it("transitions only the eligible ones and reports the rest", async () => {
    seed({
      [APP_A]: "screening_scored",
      [APP_B]: "manager_review",
      [APP_C]: "hired",
    });

    const result = await bulkCandidateAction({
      applicationIds: [APP_A, APP_B, APP_C],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(mockTransitionApplication).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ succeeded: 1, skipped: 2, failed: 0 });
    expect(result.outcomes).toHaveLength(3);
  });

  it("gives every skipped candidate a reason", async () => {
    seed({ [APP_A]: "hired", [APP_B]: "manager_review" });

    const result = await bulkCandidateAction({
      applicationIds: [APP_A, APP_B],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(result.outcomes.every((o) => o.status !== "skipped" || o.detail)).toBe(true);
  });

  it("sends each advanced candidate their notification", async () => {
    await bulkCandidateAction({
      applicationIds: [APP_A, APP_B],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(mockSendTransitionNotification).toHaveBeenCalledTimes(2);
  });

  /**
   * The transition is recorded state; the email is a courtesy. A delivery
   * failure must not report the state change as having failed, because it
   * didn't.
   */
  it("still counts a transition as succeeded when its email fails", async () => {
    mockSendTransitionNotification.mockRejectedValue(new Error("Gmail disconnected"));

    const result = await bulkCandidateAction({
      applicationIds: [APP_A],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });
});

describe("bulkCandidateAction — reject", () => {
  it("records a disposition on every rejection", async () => {
    await bulkCandidateAction({
      applicationIds: [APP_A],
      action: "reject",
      rationale: RATIONALE,
    });

    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "rejected",
        disposition: { code: "OVERRIDE_REJECTED", description: RATIONALE },
      }),
    );
  });

  /**
   * #144 opened `archived → rejected` so un-archiving can restore the real
   * prior state. A bulk reject riding that edge would file an archived person
   * as a fresh rejection.
   */
  it("skips an archived application rather than re-closing it", async () => {
    seed({ [APP_A]: "archived" });

    const result = await bulkCandidateAction({
      applicationIds: [APP_A],
      action: "reject",
      rationale: RATIONALE,
    });

    expect(mockTransitionApplication).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});

describe("bulkCandidateAction — talent pool", () => {
  it("pools every selected candidate regardless of stage", async () => {
    seed({ [APP_A]: "rejected", [APP_B]: "hired" });

    const result = await bulkCandidateAction({
      applicationIds: [APP_A, APP_B],
      action: "talent_pool",
      tags: ["  React ", "react"],
    });

    expect(mockUpsertTalentPoolEntry).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toBe(2);
  });

  it("normalizes tags once for the whole batch", async () => {
    await bulkCandidateAction({
      applicationIds: [APP_A],
      action: "talent_pool",
      tags: ["  React ", "react", ""],
    });

    expect(mockUpsertTalentPoolEntry.mock.calls[0][1].tags).toEqual(["React"]);
  });

  it("records where each person was pooled from", async () => {
    await bulkCandidateAction({ applicationIds: [APP_A], action: "talent_pool" });

    expect(mockUpsertTalentPoolEntry.mock.calls[0][1]).toMatchObject({
      sourceApplicationId: APP_A,
      sourceCampaignId: CAMPAIGN_ID,
    });
  });

  it("never transitions anything", async () => {
    await bulkCandidateAction({ applicationIds: [APP_A], action: "talent_pool" });

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });
});

describe("bulkCandidateAction — failures", () => {
  /**
   * One failure abandoning the rest would leave the recruiter unable to tell
   * which half of the batch ran.
   */
  it("continues the batch after one application fails", async () => {
    mockTransitionApplication
      .mockRejectedValueOnce(new Error("Concurrent state change"))
      .mockResolvedValueOnce(undefined);

    const result = await bulkCandidateAction({
      applicationIds: [APP_A, APP_B],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.outcomes.find((o) => o.status === "failed")?.detail).toContain(
      "Concurrent",
    );
  });

  it("reports an application the caller cannot reach as failed, not missing", async () => {
    // Silently dropping it would let a crafted or stale id vanish from the
    // report, which is exactly what "nothing fails silently" forbids.
    seed({ [APP_A]: "screening_scored" });

    const result = await bulkCandidateAction({
      applicationIds: [APP_A, APP_C],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(result.outcomes).toHaveLength(2);
    expect(result.failed).toBe(1);
  });

  it("survives an ownership error on one application", async () => {
    mockFetchCandidateById.mockImplementation(async (id: string) => {
      if (id === APP_C) throw new Error("Access denied");
      return {
        id,
        campaign_id: CAMPAIGN_ID,
        candidate_id: `cand-${id}`,
        status: "screening_scored",
        candidates: { first_name: "Ada", last_name: "L", email: "ada@example.com" },
      };
    });

    const result = await bulkCandidateAction({
      applicationIds: [APP_A, APP_C],
      action: "advance",
      rationale: RATIONALE,
    });

    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
  });
});
