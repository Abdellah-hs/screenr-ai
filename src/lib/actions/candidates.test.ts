import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_APP_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";
const VALID_RATIONALE = "Strong React experience; advancing.";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockFetchCandidateById,
  mockTransitionApplication,
  mockRevalidatePath,
  mockSendScreeningQuestions,
  mockFetchCampaignStatus,
  mockAssertCampaignActiveById,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockTransitionApplication: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockSendScreeningQuestions: vi.fn(),
  mockFetchCampaignStatus: vi.fn(),
  mockAssertCampaignActiveById: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/lib/data/candidates", () => ({
  fetchCandidateById: mockFetchCandidateById,
  // The action module also imports these, even if decideHitlReview doesn't use
  // them — they must be mocked for the module to load.
  fetchCandidatesByCampaignId: vi.fn(),
  updateApplicationStage: vi.fn(),
  advanceApplicationStatus: vi.fn(),
  getResumeSignedUrl: vi.fn(),
  saveResumeScore: vi.fn(),
  fetchApplicationCampaignId: vi.fn(),
}));

vi.mock("@/lib/data/transitions", () => ({
  transitionApplication: mockTransitionApplication,
}));

// decideHitlReview auto-sends screening questions on approval via this action;
// mock it so the unit under test stays focused on the approval decision.
vi.mock("@/lib/actions/screening-questions", () => ({
  sendScreeningQuestionsToCandidate: mockSendScreeningQuestions,
}));

vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignScoringConfig: vi.fn(),
  fetchCampaignStatus: mockFetchCampaignStatus,
  fetchActiveRubricVersion: vi.fn(),
}));

// Freeze guard — default to a no-op (active) so existing tests are unaffected;
// gate tests override it to reject.
vi.mock("./campaign-guards", () => ({
  assertCampaignActiveById: mockAssertCampaignActiveById,
}));

vi.mock("@/lib/services/openai", () => ({
  scoreResumeAgainstCriteria: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import {
  decideHitlReview,
  scoreUnscoredCampaignCandidates,
  updateCandidateStage,
} from "./candidates";
import { scoreResumeAgainstCriteria } from "@/lib/services/openai";
import {
  updateApplicationStage,
  fetchApplicationCampaignId,
  fetchCandidatesByCampaignId,
  advanceApplicationStatus,
  saveResumeScore,
} from "@/lib/data/candidates";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";

beforeEach(() => {
  mockRequireUserId.mockReset();
  mockCheckRateLimit.mockReset();
  mockFetchCandidateById.mockReset();
  mockTransitionApplication.mockReset();
  mockRevalidatePath.mockReset();
  mockSendScreeningQuestions.mockReset();
  mockFetchCampaignStatus.mockReset();
  mockAssertCampaignActiveById.mockReset();

  // Default happy-path setup — individual tests override what they need.
  mockRequireUserId.mockResolvedValue("user-1");
  // Campaigns are Active by default so the freeze gate is transparent; the
  // freeze tests override these.
  mockFetchCampaignStatus.mockResolvedValue("active");
  mockAssertCampaignActiveById.mockResolvedValue(undefined);
  mockFetchCandidateById.mockResolvedValue({
    id: VALID_APP_ID,
    campaign_id: VALID_CAMPAIGN_ID,
    status: "screening_review_pending",
  });
  mockTransitionApplication.mockResolvedValue(undefined);
  mockSendScreeningQuestions.mockResolvedValue({ sent: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("decideHitlReview", () => {
  it("rejects unauthenticated callers before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "approve",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(mockFetchCandidateById).not.toHaveBeenCalled();
    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects an invalid applicationId via Zod (uuid format)", async () => {
    await expect(
      decideHitlReview({
        applicationId: "not-a-uuid",
        decision: "approve",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow();

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects a decision value outside the approve/reject enum", async () => {
    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        // @ts-expect-error — exercising runtime validation of an illegal enum
        decision: "maybe",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow();

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace-only rationale", async () => {
    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "reject",
        rationale: "   ",
      }),
    ).rejects.toThrow();

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("rejects a rationale shorter than 10 characters", async () => {
    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "reject",
        rationale: "too short",
      }),
    ).rejects.toThrow();

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("throws when the application cannot be found (ownership / does-not-exist)", async () => {
    mockFetchCandidateById.mockResolvedValueOnce(null);

    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "approve",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow("Application not found");

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("throws when the application is no longer in screening_review_pending", async () => {
    mockFetchCandidateById.mockResolvedValueOnce({
      id: VALID_APP_ID,
      campaign_id: VALID_CAMPAIGN_ID,
      status: "screening_approved",
    });

    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "approve",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow("no longer awaiting review");

    expect(mockTransitionApplication).not.toHaveBeenCalled();
  });

  it("on approve: transitions to screening_approved as recruiter with the rationale", async () => {
    const result = await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "approve",
      rationale: VALID_RATIONALE,
    });

    expect(mockTransitionApplication).toHaveBeenCalledTimes(1);
    expect(mockTransitionApplication).toHaveBeenCalledWith({
      applicationId: VALID_APP_ID,
      toState: "screening_approved",
      actor: "recruiter",
      rationale: VALID_RATIONALE,
    });
    expect(result).toEqual({
      success: true,
      decision: "approve",
      screeningEmailSent: true,
      screeningWarning: undefined,
    });
  });

  it("on approve: auto-sends the screening questions to the candidate", async () => {
    await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "approve",
      rationale: VALID_RATIONALE,
    });

    expect(mockSendScreeningQuestions).toHaveBeenCalledTimes(1);
    expect(mockSendScreeningQuestions).toHaveBeenCalledWith(VALID_APP_ID);
  });

  it("on approve: still approves and returns a warning when the auto-send fails", async () => {
    const sendError = "This campaign has no screening questions configured. Set them up first.";
    mockSendScreeningQuestions.mockRejectedValueOnce(new Error(sendError));

    const result = await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "approve",
      rationale: VALID_RATIONALE,
    });

    // The approval transition must have happened despite the send failing.
    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "screening_approved" }),
    );
    expect(result).toEqual({
      success: true,
      decision: "approve",
      screeningEmailSent: false,
      screeningWarning: sendError,
    });
  });

  it("on reject: transitions to rejected as recruiter with the rationale", async () => {
    const result = await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "reject",
      rationale: VALID_RATIONALE,
    });

    expect(mockTransitionApplication).toHaveBeenCalledTimes(1);
    expect(mockTransitionApplication).toHaveBeenCalledWith({
      applicationId: VALID_APP_ID,
      toState: "rejected",
      actor: "recruiter",
      rationale: VALID_RATIONALE,
    });
    expect(result).toEqual({
      success: true,
      decision: "reject",
      screeningEmailSent: false,
      screeningWarning: undefined,
    });
  });

  it("on reject: never sends screening questions", async () => {
    await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "reject",
      rationale: VALID_RATIONALE,
    });

    expect(mockSendScreeningQuestions).not.toHaveBeenCalled();
  });

  it("on approve: freezes (no transition, no send) when the campaign isn't Active", async () => {
    mockAssertCampaignActiveById.mockRejectedValueOnce(
      new Error("This campaign is paused. Set it to Active to sync resumes, score candidates, or send screening."),
    );

    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "approve",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow(/paused/i);

    expect(mockTransitionApplication).not.toHaveBeenCalled();
    expect(mockSendScreeningQuestions).not.toHaveBeenCalled();
  });

  it("on reject: is NOT frozen — rejecting works even on a non-active campaign", async () => {
    // Guard would throw if consulted; rejecting must not consult it (a stop, not
    // processing), so the rejection still goes through.
    mockAssertCampaignActiveById.mockRejectedValue(new Error("frozen"));

    await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "reject",
      rationale: VALID_RATIONALE,
    });

    expect(mockAssertCampaignActiveById).not.toHaveBeenCalled();
    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "rejected", actor: "recruiter" }),
    );
  });

  it("checks the hitl-review rate limit against the authenticated user", async () => {
    await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "approve",
      rationale: VALID_RATIONALE,
    });

    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "hitl-review" }),
    );
  });

  it("revalidates the campaign list and candidate detail paths after a decision", async () => {
    await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "approve",
      rationale: VALID_RATIONALE,
    });

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/campaigns/${VALID_CAMPAIGN_ID}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}/candidates/${VALID_APP_ID}`,
    );
  });
});

describe("updateCandidateStage", () => {
  it("rejects unauthenticated callers before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      updateCandidateStage(VALID_APP_ID, "screening_approved", VALID_RATIONALE),
    ).rejects.toThrow("Unauthorized");

    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
  });

  it("rejects an invalid applicationId via Zod (uuid format)", async () => {
    await expect(
      updateCandidateStage("not-a-uuid", "screening_approved", VALID_RATIONALE),
    ).rejects.toThrow();

    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
  });

  it("rejects a state value outside candidate_stage_enum", async () => {
    await expect(
      updateCandidateStage(VALID_APP_ID, "banana", VALID_RATIONALE),
    ).rejects.toThrow();

    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
  });

  it("rejects a coarse CandidateStage value such as 'applied'", async () => {
    await expect(
      updateCandidateStage(VALID_APP_ID, "applied", VALID_RATIONALE),
    ).rejects.toThrow();

    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace-only rationale", async () => {
    await expect(
      updateCandidateStage(VALID_APP_ID, "screening_approved", "   "),
    ).rejects.toThrow();

    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
  });

  it("rejects a system-produced state a recruiter must not fabricate (e.g. screening_scored)", async () => {
    await expect(
      updateCandidateStage(VALID_APP_ID, "screening_scored", VALID_RATIONALE),
    ).rejects.toThrow(/can't be set manually/);

    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
  });

  it("delegates to updateApplicationStage with the validated state and trimmed rationale", async () => {
    await updateCandidateStage(
      VALID_APP_ID,
      "screening_approved",
      "  Strong fit, advancing.  ",
    );

    expect(vi.mocked(updateApplicationStage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateApplicationStage)).toHaveBeenCalledWith(
      VALID_APP_ID,
      "screening_approved",
      "Strong fit, advancing.",
    );
  });

  it("revalidates the campaign list and candidate detail paths on success", async () => {
    vi.mocked(fetchApplicationCampaignId).mockResolvedValueOnce(VALID_CAMPAIGN_ID);

    await updateCandidateStage(VALID_APP_ID, "screening_approved", VALID_RATIONALE);

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/campaigns/${VALID_CAMPAIGN_ID}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}/candidates/${VALID_APP_ID}`,
    );
  });
});

// Auto-scoring on criteria save — replaces the retired manual "Score Resume"
// button. Sets up the scoring chain's mocks (config + rubric + score).
describe("scoreUnscoredCampaignCandidates", () => {
  function appRow(over: Record<string, unknown> = {}) {
    return {
      id: "app-1",
      resume_score: null,
      parsed_data: { first_name: "Alice" },
      candidates: { id: "cand-1" },
      ...over,
    };
  }

  beforeEach(() => {
    mockFetchCampaignStatus.mockResolvedValue("active");
    vi.mocked(fetchCampaignScoringConfig).mockResolvedValue({
      description: "Senior engineer role",
      automation_mode: "fully_auto",
      screening_threshold: 70,
      screening_criteria: [
        { id: "c1", label: "React", weight: 1, is_mandatory: false, min_score: 0 },
      ],
    } as never);
    vi.mocked(fetchActiveRubricVersion).mockResolvedValue(1);
    vi.mocked(saveResumeScore).mockResolvedValue(undefined as never);
    vi.mocked(scoreResumeAgainstCriteria).mockResolvedValue({
      result: { overall_score: 85, tier: "strong", rationale: "ok", factors: [] },
      model: "gpt-test",
      promptVersion: "v1",
      rawOutput: "{}",
    } as never);
  });

  it("does nothing when the campaign has no criteria", async () => {
    vi.mocked(fetchCampaignScoringConfig).mockResolvedValue(null);
    vi.mocked(fetchCandidatesByCampaignId).mockResolvedValue([appRow()] as never);

    await scoreUnscoredCampaignCandidates(VALID_CAMPAIGN_ID, "user-1");

    expect(vi.mocked(scoreResumeAgainstCriteria)).not.toHaveBeenCalled();
    expect(vi.mocked(advanceApplicationStatus)).not.toHaveBeenCalled();
  });

  it("does nothing when the campaign isn't Active (freeze rule)", async () => {
    mockFetchCampaignStatus.mockResolvedValue("paused");
    vi.mocked(fetchCandidatesByCampaignId).mockResolvedValue([appRow()] as never);

    await scoreUnscoredCampaignCandidates(VALID_CAMPAIGN_ID, "user-1");

    expect(vi.mocked(scoreResumeAgainstCriteria)).not.toHaveBeenCalled();
  });

  it("scores only unscored candidates that have parsed resume data", async () => {
    vi.mocked(fetchCandidatesByCampaignId).mockResolvedValue([
      appRow({ id: "app-unscored" }),
      appRow({ id: "app-scored", resume_score: 90 }), // already scored — skip
      appRow({ id: "app-noparse", parsed_data: null }), // nothing to score — skip
    ] as never);

    await scoreUnscoredCampaignCandidates(VALID_CAMPAIGN_ID, "user-1");

    expect(vi.mocked(scoreResumeAgainstCriteria)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(advanceApplicationStatus)).toHaveBeenCalledWith(
      "app-unscored",
      expect.any(String),
      expect.any(String),
    );
  });

  it("keeps scoring the rest when one candidate fails (best-effort)", async () => {
    vi.mocked(fetchCandidatesByCampaignId).mockResolvedValue([
      appRow({ id: "app-1" }),
      appRow({ id: "app-2", candidates: { id: "cand-2" } }),
    ] as never);
    vi.mocked(scoreResumeAgainstCriteria).mockRejectedValueOnce(new Error("openai down"));

    await scoreUnscoredCampaignCandidates(VALID_CAMPAIGN_ID, "user-1");

    expect(vi.mocked(scoreResumeAgainstCriteria)).toHaveBeenCalledTimes(2);
  });
});
