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
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchCandidateById: vi.fn(),
  mockTransitionApplication: vi.fn(),
  mockRevalidatePath: vi.fn(),
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
  uploadResumeToStorage: vi.fn(),
  upsertCandidate: vi.fn(),
  createApplicationIfNotExists: vi.fn(),
  logAiAudit: vi.fn(),
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

vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignScoringConfig: vi.fn(),
}));

vi.mock("@/lib/services/gmail", () => ({
  fetchUnreadGmailResumes: vi.fn(),
  getGmailMessage: vi.fn(),
  getGmailAttachmentBuffer: vi.fn(),
  markGmailMessageAsRead: vi.fn(),
  isSupportedResumeMimeType: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/services/pdf", () => ({
  parsePdf: vi.fn(),
}));

vi.mock("@/lib/services/docx", () => ({
  parseDocx: vi.fn(),
}));

vi.mock("@/lib/services/openai", () => ({
  extractResumeData: vi.fn(),
  scoreResumeAgainstCriteria: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import { decideHitlReview, syncResumesFromGmail, updateCandidateStage } from "./candidates";
import { extractResumeData } from "@/lib/services/openai";
import {
  fetchUnreadGmailResumes,
  getGmailMessage,
  getGmailAttachmentBuffer,
  markGmailMessageAsRead,
} from "@/lib/services/gmail";
import { parsePdf } from "@/lib/services/pdf";
import {
  upsertCandidate,
  createApplicationIfNotExists,
  uploadResumeToStorage,
  logAiAudit,
  updateApplicationStage,
  fetchApplicationCampaignId,
} from "@/lib/data/candidates";
import { fetchCampaignScoringConfig } from "@/lib/data/campaigns";

beforeEach(() => {
  mockRequireUserId.mockReset();
  mockCheckRateLimit.mockReset();
  mockFetchCandidateById.mockReset();
  mockTransitionApplication.mockReset();
  mockRevalidatePath.mockReset();

  // Default happy-path setup — individual tests override what they need.
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchCandidateById.mockResolvedValue({
    id: VALID_APP_ID,
    campaign_id: VALID_CAMPAIGN_ID,
    status: "screening_review_pending",
  });
  mockTransitionApplication.mockResolvedValue(undefined);
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
    expect(result).toEqual({ success: true, decision: "approve" });
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
    expect(result).toEqual({ success: true, decision: "reject" });
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

describe("syncResumesFromGmail", () => {
  const PDF_MIME = "application/pdf";

  function resumePayload(overrides: Record<string, unknown> = {}) {
    return {
      first_name: "Alice",
      last_name: "Smith",
      headline: null,
      summary: null,
      email: "alice@example.com",
      phone: "+1-555-0100",
      location: "NYC",
      linkedin_url: null,
      portfolio_url: null,
      skills: ["React"],
      languages: [],
      interests: [],
      certifications: [],
      experience: [],
      education: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    // Single message, single PDF attachment, fetchable buffer.
    vi.mocked(fetchUnreadGmailResumes).mockResolvedValue([{ id: "msg-1" }]);
    vi.mocked(getGmailMessage).mockResolvedValue({
      payload: {
        parts: [
          {
            mimeType: PDF_MIME,
            filename: "alice.pdf",
            body: { attachmentId: "att-1" },
          },
        ],
      },
    });
    vi.mocked(getGmailAttachmentBuffer).mockResolvedValue(Buffer.from("fake-pdf"));
    vi.mocked(parsePdf).mockResolvedValue("Alice's resume text");

    vi.mocked(uploadResumeToStorage).mockResolvedValue("campaigns/c1/alice.pdf");
    vi.mocked(createApplicationIfNotExists).mockResolvedValue("app-1");
    vi.mocked(upsertCandidate).mockResolvedValue("candidate-1");
    vi.mocked(logAiAudit).mockResolvedValue(undefined);

    // No scoring config configured for this campaign — skip the scoring path.
    vi.mocked(fetchCampaignScoringConfig).mockResolvedValue(null);
  });

  it("skips messages where the AI could not extract an email and marks them read", async () => {
    vi.mocked(extractResumeData).mockResolvedValueOnce(resumePayload({ email: null }));

    const result = await syncResumesFromGmail(VALID_CAMPAIGN_ID);

    expect(vi.mocked(upsertCandidate)).not.toHaveBeenCalled();
    expect(vi.mocked(createApplicationIfNotExists)).not.toHaveBeenCalled();
    expect(vi.mocked(markGmailMessageAsRead)).toHaveBeenCalledWith("msg-1");
    expect(result.count).toBe(0);
  });

  it("ingests a message when the AI extracts an email", async () => {
    vi.mocked(extractResumeData).mockResolvedValueOnce(resumePayload());

    const result = await syncResumesFromGmail(VALID_CAMPAIGN_ID);

    expect(vi.mocked(upsertCandidate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertCandidate)).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com" }),
    );
    expect(vi.mocked(createApplicationIfNotExists)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markGmailMessageAsRead)).toHaveBeenCalledWith("msg-1");
    expect(result.count).toBe(1);
  });
});
