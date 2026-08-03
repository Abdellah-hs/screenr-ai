import { describe, expect, it } from "vitest";
import { evaluateInterviewScoringOutcome } from "./interview-scoring";

describe("evaluateInterviewScoringOutcome", () => {
  it("records the score by advancing to interview_scored (record-only)", () => {
    const transitions = evaluateInterviewScoringOutcome({ overall_score: 82 });

    expect(transitions).toHaveLength(1);
    expect(transitions[0].toState).toBe("interview_scored");
    expect(transitions[0].rationale).toContain("82");
  });

  it("never auto-advances or auto-rejects — even a low score stops at interview_scored", () => {
    const transitions = evaluateInterviewScoringOutcome({ overall_score: 5 });

    expect(transitions).toHaveLength(1);
    expect(transitions[0].toState).toBe("interview_scored");
  });
});
