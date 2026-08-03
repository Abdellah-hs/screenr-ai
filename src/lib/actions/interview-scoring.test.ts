import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchSession,
  mockSaveScore,
  mockScoreInterview,
  mockFetchRubricVersion,
  mockTransitionSystem,
} = vi.hoisted(() => ({
  mockFetchSession: vi.fn(),
  mockSaveScore: vi.fn(),
  mockScoreInterview: vi.fn(),
  mockFetchRubricVersion: vi.fn(),
  mockTransitionSystem: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __brand: "admin-client" }),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  fetchInterviewSessionByApplicationId: mockFetchSession,
  saveInterviewScore: mockSaveScore,
}));
vi.mock("@/lib/services/interview-scoring", () => ({ scoreInterview: mockScoreInterview }));
vi.mock("@/lib/data/campaigns", () => ({ fetchActiveRubricVersion: mockFetchRubricVersion }));
vi.mock("@/lib/data/transitions", () => ({ transitionApplicationAsSystem: mockTransitionSystem }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The pure rule stays real so the record-only decision is actually exercised.
import { runInterviewScoring } from "./interview-scoring";

const COMPLETED_SESSION = {
  status: "completed",
  transcript: [
    { role: "agent", text: "Q", at: "t1" },
    { role: "candidate", text: "A", at: "t2" },
  ],
};

const EVIDENCE = {
  result: {
    overall_score: 82,
    overall_rationale: "Strong.",
    dimensions: [{ name: "Depth", score: 82, rationale: "r", evidence_quote: "A" }],
    strengths: ["Depth"],
    concerns: [],
  },
  rawOutput: "{}",
  model: "gpt-4o-mini",
  promptVersion: "v1_interview_scoring",
};

const INPUT = {
  applicationId: "app-1",
  campaignId: "camp-1",
  candidateId: "cand-1",
  ownerUserId: "user-1",
  description: "Senior Backend Engineer",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSession.mockResolvedValue(COMPLETED_SESSION);
  mockScoreInterview.mockResolvedValue(EVIDENCE);
  mockFetchRubricVersion.mockResolvedValue(3);
});

describe("runInterviewScoring", () => {
  it("throws when there is no interview session", async () => {
    mockFetchSession.mockResolvedValue(null);
    await expect(runInterviewScoring(INPUT)).rejects.toThrow(/no interview session/i);
    expect(mockSaveScore).not.toHaveBeenCalled();
  });

  it("throws when the session isn't completed yet", async () => {
    mockFetchSession.mockResolvedValue({ status: "in_progress", transcript: [] });
    await expect(runInterviewScoring(INPUT)).rejects.toThrow(/not ready to score/i);
    expect(mockSaveScore).not.toHaveBeenCalled();
  });

  it("persists the score (with rubric version) and advances to interview_scored", async () => {
    const result = await runInterviewScoring(INPUT);

    expect(mockScoreInterview).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: COMPLETED_SESSION.transcript }),
    );
    expect(mockSaveScore).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-1",
        score: expect.objectContaining({ overall_score: 82, rubric_version: 3 }),
      }),
      expect.objectContaining({ __brand: "admin-client" }),
    );
    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-1",
      "interview_scored",
      expect.stringContaining("82"),
    );
    expect(result).toEqual({ overall_score: 82 });
  });
});
