import { describe, expect, it } from "vitest";
import {
  evaluateInterviewScoringOutcome,
  assertInterviewRescoreAllowed,
} from "./interview-scoring";

const HITL = { automation_mode: "human_in_loop" } as const;
const AUTO = { automation_mode: "fully_auto" } as const;

describe("evaluateInterviewScoringOutcome", () => {
  it("always records the score by passing through interview_scored first", () => {
    // The audit log must show the scoring event before any advancement, in
    // both modes — otherwise a fully_auto application appears to jump straight
    // to manager_review with no evidence of what produced it.
    for (const config of [HITL, AUTO]) {
      const transitions = evaluateInterviewScoringOutcome({ overall_score: 82 }, config);

      expect(transitions[0].toState).toBe("interview_scored");
      expect(transitions[0].rationale).toContain("82");
    }
  });

  it("rests at interview_scored under human-in-the-loop", () => {
    const transitions = evaluateInterviewScoringOutcome({ overall_score: 82 }, HITL);

    expect(transitions).toHaveLength(1);
    expect(transitions[0].toState).toBe("interview_scored");
  });

  /**
   * Nothing in the codebase moved an application into `manager_review` before
   * this: every earlier stage auto-advanced on a rule and this one silently
   * stopped, so a fully_auto campaign parked scored interviews forever —
   * contradicting the mode the recruiter explicitly chose.
   */
  it("advances to manager_review under fully_auto", () => {
    const transitions = evaluateInterviewScoringOutcome({ overall_score: 82 }, AUTO);

    expect(transitions.map((t) => t.toState)).toEqual([
      "interview_scored",
      "manager_review",
    ]);
  });

  /**
   * The score is recorded evidence, not a gate. Rejecting someone who sat a
   * whole interview on a single number is the decision most worth keeping
   * human, and `manager_review` is a handoff point rather than an outcome.
   */
  it("never auto-rejects, however low the score", () => {
    for (const config of [HITL, AUTO]) {
      const transitions = evaluateInterviewScoringOutcome({ overall_score: 3 }, config);

      expect(transitions.map((t) => t.toState)).not.toContain("rejected");
    }
  });

  it("sends a low score to the same place as a high one under fully_auto", () => {
    // No threshold: a human reads the evidence either way.
    const low = evaluateInterviewScoringOutcome({ overall_score: 3 }, AUTO);
    const high = evaluateInterviewScoringOutcome({ overall_score: 97 }, AUTO);

    expect(low.map((t) => t.toState)).toEqual(high.map((t) => t.toState));
  });

  it("defaults to the cautious mode when no config is supplied", () => {
    // A caller that forgets to pass config must never auto-advance anyone.
    const transitions = evaluateInterviewScoringOutcome({ overall_score: 82 });

    expect(transitions).toHaveLength(1);
    expect(transitions[0].toState).toBe("interview_scored");
  });
});

describe("assertInterviewRescoreAllowed", () => {
  it.each(["hired", "rejected", "archived"] as const)(
    "throws for the closed state %s",
    (status) => {
      expect(() => assertInterviewRescoreAllowed(status)).toThrow(/closed/);
    },
  );

  it.each([
    "interview_completed",
    "interview_scored",
    "manager_review",
    "final_interview_scheduling",
  ] as const)("allows the in-pipeline state %s", (status) => {
    expect(() => assertInterviewRescoreAllowed(status)).not.toThrow();
  });

  /**
   * Deliberately unlike the screening re-score, which refuses an already-scored
   * response. Moving an interview scored by the retired numeric prompt onto the
   * current rules is the whole reason this exists.
   */
  it("allows an interview that has already been scored", () => {
    expect(() => assertInterviewRescoreAllowed("interview_scored")).not.toThrow();
  });
});
