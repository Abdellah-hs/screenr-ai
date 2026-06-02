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

  describe("mandatory-criteria knockout gate", () => {
    // A criterion + its paired factor (factors are index-aligned to criteria
    // per the scoring prompt contract). Helper keeps the AAA blocks readable.
    function withCriteria(
      criteria: { label: string; is_mandatory: boolean }[],
      factorScores: number[],
    ) {
      return {
        config: makeConfig({
          automation_mode: "fully_auto",
          screening_threshold: 70,
          screening_criteria: criteria.map((c, i) => ({
            id: `crit-${i}`,
            label: c.label,
            weight: Math.round(100 / criteria.length),
            is_mandatory: c.is_mandatory,
          })),
        }),
        result: makeResult({
          overall_score: 85, // comfortably clears threshold — isolates the gate
          factors: criteria.map((c, i) => ({
            name: c.label,
            weight: Math.round(100 / criteria.length),
            score: factorScores[i],
          })),
        }),
      };
    }

    it("rejects when a mandatory criterion scores below the fail line, even though overall clears the threshold", () => {
      const { config, result } = withCriteria(
        [
          { label: "React", is_mandatory: true },
          { label: "Communication", is_mandatory: false },
        ],
        [20, 95],
      );

      const decision = evaluateResumeScoringOutcome(result, config);

      expect(decision.toState).toBe("rejected");
      expect(decision.rationale).toContain("React");
      expect(decision.rationale).toContain("LOW_SCORE");
    });

    it("approves when every mandatory criterion clears the fail line and overall passes", () => {
      const { config, result } = withCriteria(
        [
          { label: "React", is_mandatory: true },
          { label: "Communication", is_mandatory: false },
        ],
        [80, 40],
      );

      const decision = evaluateResumeScoringOutcome(result, config);

      expect(decision.toState).toBe("screening_approved");
    });

    it("does not trip on a low score for a non-mandatory criterion", () => {
      const { config, result } = withCriteria(
        [
          { label: "React", is_mandatory: true },
          { label: "Nice-to-have", is_mandatory: false },
        ],
        [90, 5],
      );

      const decision = evaluateResumeScoringOutcome(result, config);

      expect(decision.toState).toBe("screening_approved");
    });

    it("treats a mandatory score exactly at the fail line as a pass (boundary)", () => {
      const { config, result } = withCriteria(
        [{ label: "React", is_mandatory: true }],
        [30],
      );

      const decision = evaluateResumeScoringOutcome(result, config);

      expect(decision.toState).toBe("screening_approved");
    });

    it("applies the gate in human_in_loop mode too — a hard fail is a hard fail", () => {
      const { config, result } = withCriteria(
        [{ label: "React", is_mandatory: true }],
        [12],
      );

      const decision = evaluateResumeScoringOutcome(result, {
        ...config,
        automation_mode: "human_in_loop",
      });

      expect(decision.toState).toBe("rejected");
      expect(decision.rationale).toContain("React");
    });

    it("still routes to review_pending in HITL when mandatory criteria pass", () => {
      const { config, result } = withCriteria(
        [{ label: "React", is_mandatory: true }],
        [88],
      );

      const decision = evaluateResumeScoringOutcome(result, {
        ...config,
        automation_mode: "human_in_loop",
      });

      expect(decision.toState).toBe("screening_review_pending");
    });

    it("evaluates the gate before the overall threshold (gate wins on the rationale)", () => {
      const { config, result } = withCriteria(
        [{ label: "React", is_mandatory: true }],
        [10],
      );
      // Drag overall below threshold too — both paths reject, but the gate
      // must own the rationale so the reason surfaces as the required failure.
      const lowOverall = makeResult({ ...result, overall_score: 40 });

      const decision = evaluateResumeScoringOutcome(lowOverall, config);

      expect(decision.toState).toBe("rejected");
      expect(decision.rationale).toContain("React");
    });

    it("falls through to normal threshold logic when no factor is paired to a mandatory criterion (malformed AI output)", () => {
      const config = makeConfig({
        automation_mode: "fully_auto",
        screening_threshold: 70,
        screening_criteria: [{ id: "c1", label: "React", weight: 100, is_mandatory: true }],
      });
      const result = makeResult({ overall_score: 85, factors: [] });

      const decision = evaluateResumeScoringOutcome(result, config);

      expect(decision.toState).toBe("screening_approved");
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
