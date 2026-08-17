import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_APP_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";
const VALID_RATIONALE =
  "Strongest interview of the round; wants the team to meet them before an offer.";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockFetchCandidateById,
  mockTransitionApplication,
  mockSendTransitionNotification,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockTransitionApplication: vi.fn(),
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
vi.mock("@/lib/actions/transition-notifications", () => ({
  sendTransitionNotification: mockSendTransitionNotification,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { decideManagerReview } from "./manager-review";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchCandidateById.mockResolvedValue({
    id: VALID_APP_ID,
    campaign_id: VALID_CAMPAIGN_ID,
    status: "manager_review",
  });
  mockTransitionApplication.mockResolvedValue(undefined);
  mockSendTransitionNotification.mockResolvedValue(undefined);
});

function decide(overrides: Record<string, unknown> = {}) {
  return decideManagerReview({
    applicationId: VALID_APP_ID,
    decision: "advance",
    rationale: VALID_RATIONALE,
    ...overrides,
  } as Parameters<typeof decideManagerReview>[0]);
}

describe("decideManagerReview", () => {
  it("advances to the final human interview and records the manager as the actor", async () => {
    const result = await decide();

    expect(result).toEqual({ toState: "final_interview_scheduling" });
    expect(mockTransitionApplication).toHaveBeenCalledWith({
      applicationId: VALID_APP_ID,
      toState: "final_interview_scheduling",
      actor: "recruiter",
      rationale: VALID_RATIONALE,
      // Nothing closed, so there is no reason to record.
      disposition: undefined,
    });
  });

  it("routes a hire decision straight to hired", async () => {
    const result = await decide({ decision: "hire" });

    expect(result).toEqual({ toState: "hired" });
    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "hired" }),
    );
  });

  it("routes a reject decision to rejected", async () => {
    const result = await decide({ decision: "reject" });

    expect(result).toEqual({ toState: "rejected" });
  });

  it("records the manager's chosen rejection code as the disposition", async () => {
    await decide({ decision: "reject", rejectionCode: "OVERRIDE_REJECTED" });

    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: { code: "OVERRIDE_REJECTED", description: VALID_RATIONALE },
      }),
    );
  });

  it("falls back to a weak-evidence rejection when no code is supplied", async () => {
    // The field is optional on the wire, and a decision must never be lost to
    // a missing one — a stale client posting the old shape still records.
    await decide({ decision: "reject" });

    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: expect.objectContaining({ code: "FAILED_INTERVIEW" }),
      }),
    );
  });

  it("does not attach a rejection code to a decision that keeps the candidate", async () => {
    await decide({ decision: "hire", rejectionCode: "OVERRIDE_REJECTED" });

    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: undefined }),
    );
  });

  // Anonymous callers must never reach the state machine. requireUserId throws
  // before anything else runs.
  it("refuses an unauthenticated caller before touching the application", async () => {
    mockRequireUserId.mockRejectedValue(new Error("Unauthorized"));

    await expect(decide()).rejects.toThrow("Unauthorized");
    expect(mockFetchCandidateById).not.toHaveBeenCalled();
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  // fetchCandidateById is scoped to the recruiter's own campaigns, so a null
  // result is someone else's application as much as a missing one.
  it("refuses an application the recruiter does not own", async () => {
    mockFetchCandidateById.mockResolvedValue(null);

    await expect(decide()).rejects.toThrow("Application not found");
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  // The decision is a judgement about a specific stage. Recording it against an
  // application that already moved on would misrepresent what was reviewed.
  it("refuses to decide on an application that already left manager review", async () => {
    mockFetchCandidateById.mockResolvedValue({
      id: VALID_APP_ID,
      campaign_id: VALID_CAMPAIGN_ID,
      status: "hired",
    });

    await expect(decide()).rejects.toThrow(/no longer/i);
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("refuses to decide on an application that has not reached manager review", async () => {
    mockFetchCandidateById.mockResolvedValue({
      id: VALID_APP_ID,
      campaign_id: VALID_CAMPAIGN_ID,
      status: "interview_scored",
    });

    await expect(decide()).rejects.toThrow(/not yet/i);
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  // This is the last human judgement before an offer or a rejection, and the
  // transition log is the only place the reason survives.
  it("rejects a rationale too thin to explain the decision", async () => {
    await expect(decide({ rationale: "looks fine" })).rejects.toThrow();
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects a malformed application id", async () => {
    await expect(decide({ applicationId: "not-a-uuid" })).rejects.toThrow();
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects a decision outside the allowed set", async () => {
    await expect(decide({ decision: "archive" })).rejects.toThrow();
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("applies a rate limit to the decision", async () => {
    await decide();

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "manager-review" }),
    );
  });

  it("notifies the candidate of the outcome", async () => {
    await decide({ decision: "hire" });

    expect(mockSendTransitionNotification).toHaveBeenCalledWith(
      VALID_APP_ID,
      "hired",
      "user-1",
    );
  });

  // A recorded human decision must survive a flaky mailbox — the recruiter can
  // resend an email, but they cannot un-decide a transition.
  it("keeps the decision when the candidate email fails", async () => {
    mockSendTransitionNotification.mockRejectedValue(new Error("Gmail down"));

    const result = await decide();

    expect(result).toEqual({ toState: "final_interview_scheduling" });
    expect(mockTransitionApplication).toHaveBeenCalled();
  });

  it("refreshes the campaign and candidate pages", async () => {
    await decide();

    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}`,
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}/candidates/${VALID_APP_ID}`,
    );
  });
});
