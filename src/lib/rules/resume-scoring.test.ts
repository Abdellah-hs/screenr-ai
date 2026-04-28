import { describe, it, expect } from "vitest";
import {
  evaluateResumeScoringOutcome,
  type CampaignScoringConfig,
  type ResumeScoreResult,
} from "./resume-scoring";

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
  describe("human_in_loop mode", () => {
    it("routes to screening_review_pending regardless of how high the score is", () => {
      const decision = evaluateResumeScoringOutcome(
        makeResult({ overall_score: 99 }),
        makeConfig({ automation_mode: "human_in_loop", screening_threshold: 50 }),
      );

      expect(decision.toState).toBe("screening_review_pending");
      expect(decision.rationale).toContain("awaiting recruiter review (HITL mode)");
    });

    it("routes to screening_review_pending even when the score is below threshold", () => {
      const decision = evaluateResumeScoringOutcome(
        makeResult({ overall_score: 10 }),
        makeConfig({ automation_mode: "human_in_loop", screening_threshold: 70 }),
      );

      expect(decision.toState).toBe("screening_review_pending");
      expect(decision.rationale).toContain("HITL mode");
    });
  });

  describe("fully_auto mode", () => {
    it("routes to screening_approved when score is above threshold", () => {
      const decision = evaluateResumeScoringOutcome(
        makeResult({ overall_score: 85 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decision.toState).toBe("screening_approved");
      expect(decision.rationale).toContain("passed");
    });

    it("routes to screening_approved when score equals threshold (boundary)", () => {
      const decision = evaluateResumeScoringOutcome(
        makeResult({ overall_score: 70 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decision.toState).toBe("screening_approved");
    });

    it("routes to rejected when score is below threshold", () => {
      const decision = evaluateResumeScoringOutcome(
        makeResult({ overall_score: 40 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decision.toState).toBe("rejected");
      expect(decision.rationale).toContain("below threshold");
    });
  });

  describe("rationale shape", () => {
    it("includes the overall score and the threshold numerically", () => {
      const decision = evaluateResumeScoringOutcome(
        makeResult({ overall_score: 63 }),
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 75 }),
      );

      expect(decision.rationale).toContain("Resume score 63");
      expect(decision.rationale).toContain("threshold 75");
    });
  });
});
