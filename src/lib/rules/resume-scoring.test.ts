import { describe, it, expect } from "vitest";
import {
  evaluateResumeScoringOutcome,
  assertResumeRescoreAllowed,
  type CampaignScoringConfig,
} from "./resume-scoring";
import {
  buildDeterministicResumeScore,
  type DeterministicResumeScoreResult,
  type EvidenceLevel,
  type ResumeCriterion,
  type ValidatedResumeEvidence,
} from "@/lib/resume-scoring";

function makeConfig(overrides: Partial<CampaignScoringConfig> = {}): CampaignScoringConfig {
  return {
    id: "campaign-1",
    description: "Senior engineer",
    automation_mode: "fully_auto",
    resume_threshold: 70,
    screening_criteria: [],
    ...overrides,
  };
}

/**
 * Build a real deterministic result from evidence levels rather than hand-
 * writing the result object. The rule is only meaningful against results the
 * scorer can actually produce — a hand-built "eligible with a null ranking"
 * would test a state that cannot exist.
 */
function makeResult(
  entries: { label: string; priority: ResumeCriterion["priority"]; level: EvidenceLevel }[],
): DeterministicResumeScoreResult {
  const criteria: ResumeCriterion[] = entries.map((e, i) => ({
    id: `c${i}`,
    label: e.label,
    priority: e.priority,
  }));

  const validated: ValidatedResumeEvidence = {
    criteria: entries.map((e) => ({
      criterion_label: e.label,
      evidence_level: e.level,
      reported_evidence_level: e.level,
      evidence_items: [],
      extracted_relevant_months: null,
      notes: null,
    })),
    extraction_summary: "Summary.",
    warnings: [],
  };

  return buildDeterministicResumeScore(validated, criteria);
}

describe("evaluateResumeScoringOutcome", () => {
  describe("must-have gate", () => {
    it("rejects an ineligible candidate in fully_auto mode", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "weak" },
        { label: "Communication", priority: "nice_to_have", level: "very_strong" },
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig());

      expect(decision.toState).toBe("rejected");
      expect(decision.rationale).toContain("React");
      expect(decision.disposition).toEqual({
        code: "LOW_SCORE",
        description: "Failed must-have criteria: React",
      });
    });

    it("rejects an ineligible candidate in HITL mode too — a gate is not a review call", () => {
      const result = makeResult([{ label: "React", priority: "must_have", level: "not_present" }]);

      const decision = evaluateResumeScoringOutcome(
        result,
        makeConfig({ automation_mode: "human_in_loop" }),
      );

      expect(decision.toState).toBe("rejected");
    });

    it("names every failed must-have in the rationale", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "weak" },
        { label: "SQL", priority: "must_have", level: "partial" },
        { label: "Docker", priority: "must_have", level: "strong" },
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig());

      expect(decision.rationale).toContain("React");
      expect(decision.rationale).toContain("SQL");
      expect(decision.rationale).not.toContain("Docker");
    });

    it("does not reject on a weak nice-to-have — only must-haves gate", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "strong" },
        { label: "Docker", priority: "nice_to_have", level: "not_present" },
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 0 }));

      expect(decision.toState).toBe("screening_approved");
    });

    it("cannot be reached past by a perfect nice-to-have score", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "partial" }, // 55, below 60
        { label: "Docker", priority: "nice_to_have", level: "very_strong" }, // 100
        { label: "Testing", priority: "nice_to_have", level: "very_strong" }, // 100
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 0 }));

      expect(decision.toState).toBe("rejected");
    });
  });

  describe("human_in_loop mode", () => {
    it("routes an eligible candidate to review however high they rank", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "very_strong" },
        { label: "Docker", priority: "nice_to_have", level: "very_strong" },
      ]);

      const decision = evaluateResumeScoringOutcome(
        result,
        makeConfig({ automation_mode: "human_in_loop", resume_threshold: 50 }),
      );

      expect(decision.toState).toBe("screening_review_pending");
      expect(decision.rationale).toContain("awaiting recruiter review (HITL mode)");
    });

    it("routes an eligible candidate to review even when they rank below threshold", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "strong" },
        { label: "Docker", priority: "nice_to_have", level: "not_present" },
      ]);

      const decision = evaluateResumeScoringOutcome(
        result,
        makeConfig({ automation_mode: "human_in_loop", resume_threshold: 70 }),
      );

      expect(decision.toState).toBe("screening_review_pending");
    });
  });

  describe("fully_auto mode", () => {
    it("approves when the ranking score clears the threshold", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "strong" },
        { label: "Docker", priority: "nice_to_have", level: "very_strong" }, // ranking 100
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 70 }));

      expect(decision.toState).toBe("screening_approved");
      expect(decision.rationale).toContain("ranking score 100");
    });

    it("rejects an eligible candidate who ranks below the threshold", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "strong" },
        { label: "Docker", priority: "nice_to_have", level: "weak" }, // ranking 25
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 70 }));

      expect(decision.toState).toBe("rejected");
      expect(decision.rationale).toContain("below threshold");
      expect(decision.disposition?.code).toBe("LOW_SCORE");
    });

    it("approves an eligible candidate with no nice-to-haves at all", () => {
      const result = makeResult([{ label: "React", priority: "must_have", level: "strong" }]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 70 }));

      expect(decision.toState).toBe("screening_approved");
    });

    it("approves exactly at the threshold", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "strong" },
        { label: "Docker", priority: "nice_to_have", level: "partial" }, // ranking 55
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 55 }));

      expect(decision.toState).toBe("screening_approved");
    });
  });

  describe("rationale shape", () => {
    it("states the ranking score and threshold numerically", () => {
      const result = makeResult([
        { label: "React", priority: "must_have", level: "strong" },
        { label: "Docker", priority: "nice_to_have", level: "partial" },
      ]);

      const decision = evaluateResumeScoringOutcome(result, makeConfig({ resume_threshold: 75 }));

      expect(decision.rationale).toContain("ranking score 55");
      expect(decision.rationale).toContain("threshold 75");
    });
  });
});

describe("assertResumeRescoreAllowed", () => {
  it.each(["hired", "rejected", "archived"] as const)(
    "throws for the closed state %s",
    (status) => {
      expect(() => assertResumeRescoreAllowed(status)).toThrow(/closed/);
    },
  );

  it.each([
    "new",
    "screening_review_pending",
    "screening_approved",
    "screening_sent",
    "interview_invited",
    "manager_review",
  ] as const)("allows the in-pipeline state %s", (status) => {
    expect(() => assertResumeRescoreAllowed(status)).not.toThrow();
  });
});
