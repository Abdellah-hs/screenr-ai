import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/data/candidates", () => ({
  advanceApplicationStatus: vi.fn(),
}));

import { advanceApplicationStatus } from "@/lib/data/candidates";
import {
  evaluateResumeScoringOutcome,
  type CampaignScoringConfig,
  type ResumeScoreResult,
} from "./resume-scoring";

const mockAdvance = vi.mocked(advanceApplicationStatus);

function makeResult(overrides: Partial<ResumeScoreResult> = {}): ResumeScoreResult {
  return {
    overall_score: 80,
    tier: "strong",
    rationale: "Solid match",
    factors: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<CampaignScoringConfig> = {}): CampaignScoringConfig {
  return {
    id: "campaign-1",
    description: "Senior engineer",
    automation_mode: "fully_auto",
    screening_threshold: 70,
    screening_criteria: [],
    ...overrides,
  };
}

describe("evaluateResumeScoringOutcome", () => {
  beforeEach(() => {
    mockAdvance.mockReset();
    mockAdvance.mockResolvedValue(undefined);
  });

  describe("human_in_loop mode", () => {
    it("routes to screening_review_pending regardless of how high the score is", async () => {
      await evaluateResumeScoringOutcome(
        "app-1",
        makeResult({ overall_score: 99 }),
        makeConfig({ automation_mode: "human_in_loop", screening_threshold: 50 }),
      );

      expect(mockAdvance).toHaveBeenCalledTimes(1);
      expect(mockAdvance).toHaveBeenCalledWith(
        "app-1",
        "screening_review_pending",
        expect.stringContaining("awaiting recruiter review (HITL mode)"),
      );
    });

    it("routes to screening_review_pending even when the score is below threshold", async () => {
      await evaluateResumeScoringOutcome(
        "app-2",
        makeResult({ overall_score: 10 }),
        makeConfig({ automation_mode: "human_in_loop", screening_threshold: 70 }),
      );

      expect(mockAdvance).toHaveBeenCalledWith(
        "app-2",
        "screening_review_pending",
        expect.stringContaining("HITL mode"),
      );
    });
  });

  describe("fully_auto mode", () => {
    it("routes to screening_approved when score is above threshold", async () => {
      await evaluateResumeScoringOutcome(
        "app-3",
        makeResult({ overall_score: 85 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(mockAdvance).toHaveBeenCalledWith(
        "app-3",
        "screening_approved",
        expect.stringContaining("passed"),
      );
    });

    it("routes to screening_approved when score equals threshold (boundary)", async () => {
      await evaluateResumeScoringOutcome(
        "app-4",
        makeResult({ overall_score: 70 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(mockAdvance).toHaveBeenCalledWith(
        "app-4",
        "screening_approved",
        expect.any(String),
      );
    });

    it("routes to rejected when score is below threshold", async () => {
      await evaluateResumeScoringOutcome(
        "app-5",
        makeResult({ overall_score: 40 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(mockAdvance).toHaveBeenCalledWith(
        "app-5",
        "rejected",
        expect.stringContaining("below threshold"),
      );
    });
  });

  describe("rationale shape", () => {
    it("includes the overall score and the threshold numerically", async () => {
      await evaluateResumeScoringOutcome(
        "app-6",
        makeResult({ overall_score: 63 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 75 }),
      );

      const rationale = mockAdvance.mock.calls[0][2];
      expect(rationale).toContain("Resume score 63");
      expect(rationale).toContain("threshold 75");
    });
  });
});
