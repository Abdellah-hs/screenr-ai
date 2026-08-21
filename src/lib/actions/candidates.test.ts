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
  mockFetchScreeningQuestions,
  mockFetchTalentPoolRows,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockTransitionApplication: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockSendScreeningQuestions: vi.fn(),
  mockFetchCampaignStatus: vi.fn(),
  mockAssertCampaignActiveById: vi.fn(),
  mockFetchScreeningQuestions: vi.fn(),
  mockFetchTalentPoolRows: vi.fn(),
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

// decideHitlReview preflights the campaign's question set before approving —
// approval promises an immediate send, so a questionless campaign blocks it.
vi.mock("@/lib/data/screening-questions", () => ({
  fetchScreeningQuestionsByCampaignId: mockFetchScreeningQuestions,
}));

vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignScoringConfig: vi.fn(),
  fetchCampaignStatus: mockFetchCampaignStatus,
  fetchActiveRubricVersion: vi.fn(),
}));

vi.mock("@/lib/data/talent-pool", () => ({
  fetchTalentPoolRows: mockFetchTalentPoolRows,
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
  getCandidateById,
  getCandidatesByCampaignId,
  getTalentPool,
  rescoreCandidateResume,
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
import type { TalentPoolRow } from "@/lib/data/talent-pool";

beforeEach(() => {
  mockRequireUserId.mockReset();
  mockCheckRateLimit.mockReset();
  mockFetchCandidateById.mockReset();
  mockTransitionApplication.mockReset();
  mockRevalidatePath.mockReset();
  mockSendScreeningQuestions.mockReset();
  mockFetchCampaignStatus.mockReset();
  mockAssertCampaignActiveById.mockReset();
  mockFetchScreeningQuestions.mockReset();
  mockFetchTalentPoolRows.mockReset();

  // Default happy-path setup — individual tests override what they need.
  mockRequireUserId.mockResolvedValue("user-1");
  // Campaigns are Active by default so the freeze gate is transparent; the
  // freeze tests override these.
  mockFetchCampaignStatus.mockResolvedValue("active");
  mockAssertCampaignActiveById.mockResolvedValue(undefined);
  // Campaigns have a question set by default so the approve preflight is
  // transparent; the no-questions tests override this.
  mockFetchScreeningQuestions.mockResolvedValue([{ id: "q-1" }]);
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

describe("getTalentPool", () => {
  // One raw talent-pool row (application + embedded candidate + campaign). The
  // default is a resume-scored candidate awaiting review on a live campaign.
  function poolRow(over: Partial<TalentPoolRow> = {}): TalentPoolRow {
    return {
      id: "app-1",
      campaign_id: "camp-1",
      candidate_id: "cand-1",
      status: "screening_review_pending",
      resume_score: 82,
      screening_q_score: null,
      interview_score: null,
      screening_tier: "strong",
      score_rationale: "Strong React background",
      score_factors: [],
      scored_at: "2026-07-10T00:00:00.000Z",
      rubric_version: 1,
      created_at: "2026-07-10T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z",
      candidates: {
        id: "cand-1",
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        phone: null,
        location: "London",
        created_at: "2026-07-01T00:00:00.000Z",
      },
      campaigns: {
        id: "camp-1",
        title: "Senior Software Engineer",
        status: "active",
        deleted_at: null,
      },
      screening_question_responses: null,
      ...over,
    };
  }

  it("rejects an anonymous user before hitting the data layer", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getTalentPool()).rejects.toThrow(/unauthorized/i);
    expect(mockFetchTalentPoolRows).not.toHaveBeenCalled();
  });

  it("groups a person's applications across campaigns into one entry, newest first", async () => {
    mockFetchTalentPoolRows.mockResolvedValue([
      poolRow({
        id: "app-1",
        campaign_id: "camp-1",
        created_at: "2026-07-10T00:00:00.000Z",
        campaigns: { id: "camp-1", title: "Backend Engineer", status: "active", deleted_at: null },
      }),
      poolRow({
        id: "app-2",
        campaign_id: "camp-2",
        created_at: "2026-07-12T00:00:00.000Z",
        campaigns: { id: "camp-2", title: "Platform Engineer", status: "active", deleted_at: null },
      }),
    ]);

    const pool = await getTalentPool();

    expect(pool).toHaveLength(1);
    expect(pool[0].applications.map((a) => a.campaignTitle)).toEqual([
      "Platform Engineer",
      "Backend Engineer",
    ]);
  });

  it("keeps a person whose only campaign was removed, flagging the origin", async () => {
    mockFetchTalentPoolRows.mockResolvedValue([
      poolRow({
        campaigns: {
          id: "camp-1",
          title: "Senior Software Engineer",
          status: "active",
          deleted_at: "2026-07-15T00:00:00.000Z",
        },
      }),
    ]);

    const pool = await getTalentPool();

    expect(pool).toHaveLength(1);
    expect(pool[0].applications[0].campaignRemoved).toBe(true);
  });

  it("surfaces the current stage's score and tier for each application", async () => {
    mockFetchTalentPoolRows.mockResolvedValue([poolRow()]);

    const pool = await getTalentPool();

    expect(pool[0].applications[0].score).toEqual({
      overall: 82,
      stage: "resume",
      tier: "strong",
    });
  });
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

  it("on approve: still approves and returns a warning when the auto-send fails transiently", async () => {
    // A transient delivery failure (e.g. Gmail disconnected) must not undo the
    // recorded human decision — unlike missing questions, which block up front.
    const sendError = "No Gmail inbox is connected. Connect one under Settings → Integrations.";
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

  it("on approve: blocks before the transition when the campaign has no screening questions", async () => {
    mockFetchScreeningQuestions.mockResolvedValueOnce([]);

    await expect(
      decideHitlReview({
        applicationId: VALID_APP_ID,
        decision: "approve",
        rationale: VALID_RATIONALE,
      }),
    ).rejects.toThrow(/no screening questions/i);

    // The whole point of the preflight: no state change, no send attempt.
    expect(mockTransitionApplication).not.toHaveBeenCalled();
    expect(mockSendScreeningQuestions).not.toHaveBeenCalled();
  });

  it("on reject: is not blocked by missing screening questions", async () => {
    // Rejecting sends nothing, so the questions preflight must not apply.
    mockFetchScreeningQuestions.mockResolvedValue([]);

    await decideHitlReview({
      applicationId: VALID_APP_ID,
      decision: "reject",
      rationale: VALID_RATIONALE,
    });

    expect(mockTransitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "rejected", actor: "recruiter" }),
    );
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
      // A recruiter closing an application the rule sent to review is an
      // override, and the audit log has to be able to count those.
      disposition: { code: "OVERRIDE_REJECTED", description: VALID_RATIONALE },
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
      // Mid-pipeline, so nothing closed and there is no reason to record.
      undefined,
    );
  });

  it("records an override disposition when a recruiter closes an application by hand", async () => {
    await updateCandidateStage(VALID_APP_ID, "rejected", "  Withdrew after the offer talk.  ");

    expect(vi.mocked(updateApplicationStage)).toHaveBeenCalledWith(
      VALID_APP_ID,
      "rejected",
      "Withdrew after the offer talk.",
      { code: "OVERRIDE_REJECTED", description: "Withdrew after the offer talk." },
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
      // Diverging on purpose: the resume decision must read the CV bar. A score
      // of 85 clears 70 and would fail 95, so a regression flips the outcome.
      resume_threshold: 70,
      screening_threshold: 95,
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
      undefined,
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

// Recruiter-triggered re-score (the button next to the rubric-mismatch badge).
// Contract under test: it refreshes evidence and NEVER touches pipeline state.
describe("rescoreCandidateResume", () => {
  beforeEach(() => {
    // A live, already-scored application with parsed resume data on file.
    mockFetchCandidateById.mockResolvedValue({
      id: VALID_APP_ID,
      campaign_id: VALID_CAMPAIGN_ID,
      status: "screening_review_pending",
      parsed_data: { first_name: "Alice" },
      candidates: { id: "cand-1" },
    });
    vi.mocked(fetchCampaignScoringConfig).mockResolvedValue({
      description: "Senior engineer role",
      automation_mode: "human_in_loop",
      resume_threshold: 70,
      screening_threshold: 95,
      screening_criteria: [
        { id: "c1", label: "React", weight: 1, is_mandatory: false, min_score: 0 },
      ],
    } as never);
    vi.mocked(fetchActiveRubricVersion).mockResolvedValue(2);
    vi.mocked(saveResumeScore).mockResolvedValue(undefined as never);
    vi.mocked(scoreResumeAgainstCriteria).mockResolvedValue({
      result: { overall_score: 85, tier: "strong", rationale: "ok", factors: [] },
      model: "gpt-test",
      promptVersion: "v1",
      rawOutput: "{}",
    } as never);
  });

  it("rejects unauthenticated callers before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(rescoreCandidateResume(VALID_APP_ID)).rejects.toThrow("Unauthorized");

    expect(mockFetchCandidateById).not.toHaveBeenCalled();
    expect(vi.mocked(scoreResumeAgainstCriteria)).not.toHaveBeenCalled();
  });

  it("rejects an invalid applicationId via Zod (uuid format)", async () => {
    await expect(rescoreCandidateResume("not-a-uuid")).rejects.toThrow();

    expect(vi.mocked(scoreResumeAgainstCriteria)).not.toHaveBeenCalled();
  });

  it("throws when the application cannot be found (ownership / does-not-exist)", async () => {
    mockFetchCandidateById.mockResolvedValueOnce(null);

    await expect(rescoreCandidateResume(VALID_APP_ID)).rejects.toThrow(
      "Application not found",
    );
  });

  it("blocks re-scoring a closed application (e.g. rejected)", async () => {
    mockFetchCandidateById.mockResolvedValueOnce({
      id: VALID_APP_ID,
      campaign_id: VALID_CAMPAIGN_ID,
      status: "rejected",
      parsed_data: { first_name: "Alice" },
      candidates: { id: "cand-1" },
    });

    await expect(rescoreCandidateResume(VALID_APP_ID)).rejects.toThrow(/closed/);

    expect(vi.mocked(scoreResumeAgainstCriteria)).not.toHaveBeenCalled();
    expect(vi.mocked(saveResumeScore)).not.toHaveBeenCalled();
  });

  it("freezes when the campaign isn't Active", async () => {
    mockAssertCampaignActiveById.mockRejectedValueOnce(new Error("This campaign is paused."));

    await expect(rescoreCandidateResume(VALID_APP_ID)).rejects.toThrow(/paused/);

    expect(vi.mocked(scoreResumeAgainstCriteria)).not.toHaveBeenCalled();
  });

  it("throws when the application has no parsed resume data", async () => {
    mockFetchCandidateById.mockResolvedValueOnce({
      id: VALID_APP_ID,
      campaign_id: VALID_CAMPAIGN_ID,
      status: "screening_review_pending",
      parsed_data: null,
      candidates: { id: "cand-1" },
    });

    await expect(rescoreCandidateResume(VALID_APP_ID)).rejects.toThrow(
      /no parsed resume/,
    );
  });

  it("throws when the campaign has no resume criteria configured", async () => {
    vi.mocked(fetchCampaignScoringConfig).mockResolvedValue(null);

    await expect(rescoreCandidateResume(VALID_APP_ID)).rejects.toThrow(
      /no resume criteria/,
    );
  });

  it("persists a fresh score for the application", async () => {
    const result = await rescoreCandidateResume(VALID_APP_ID);

    expect(vi.mocked(saveResumeScore)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveResumeScore)).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: VALID_APP_ID,
        campaignId: VALID_CAMPAIGN_ID,
        candidateId: "cand-1",
        score: 85,
        rubricVersion: 2,
      }),
    );
    expect(result).toEqual({ rescored: true });
  });

  it("never transitions pipeline state — evidence refresh only", async () => {
    await rescoreCandidateResume(VALID_APP_ID);

    expect(mockTransitionApplication).not.toHaveBeenCalled();
    expect(vi.mocked(advanceApplicationStatus)).not.toHaveBeenCalled();
    expect(vi.mocked(updateApplicationStage)).not.toHaveBeenCalled();
    expect(mockSendScreeningQuestions).not.toHaveBeenCalled();
  });

  it("revalidates the campaign and candidate detail paths on success", async () => {
    await rescoreCandidateResume(VALID_APP_ID);

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/campaigns/${VALID_CAMPAIGN_ID}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}/candidates/${VALID_APP_ID}`,
    );
  });
});

// Malformed-id guards — a URL like /campaigns/undefined must never turn into
// database queries against a garbage uuid (it used to spray console errors).
describe("getCandidatesByCampaignId — id guard", () => {
  it("rejects a malformed campaign id before any fetch", async () => {
    await expect(getCandidatesByCampaignId("undefined")).rejects.toThrow();

    expect(vi.mocked(fetchCandidatesByCampaignId)).not.toHaveBeenCalled();
  });
});

describe("getCandidateById — id guard", () => {
  it("resolves null for a malformed application id without querying", async () => {
    await expect(getCandidateById("undefined")).resolves.toBeNull();

    expect(mockFetchCandidateById).not.toHaveBeenCalled();
  });
});
