import { describe, it, expect } from "vitest";
import {
  assertResponseIsOpen,
  assertResponseNotResubmitted,
  assertEligibleForScreeningSend,
  isEligibleForScreeningSend,
  isResponseExpired,
  evaluateScreeningScoringOutcome,
  ScreeningResponseError,
  SCREENING_SEND_ELIGIBLE_STATES,
  type ScreeningResponseStatus,
  type ScreeningScoringConfig,
} from "./screening-response";
import type { ApplicationState } from "@/lib/constants";

const OPEN_STATUSES: ScreeningResponseStatus[] = ["pending", "sent", "responded"];

describe("isResponseExpired", () => {
  const deadline = new Date("2026-06-03T12:00:00.000Z");

  it("returns true when now is past the deadline", () => {
    const now = new Date("2026-06-03T12:00:01.000Z");
    expect(isResponseExpired(deadline, now)).toBe(true);
  });

  it("returns false when now is before the deadline", () => {
    const now = new Date("2026-06-03T11:59:59.000Z");
    expect(isResponseExpired(deadline, now)).toBe(false);
  });

  it("returns false exactly at the deadline (boundary is not yet expired)", () => {
    const now = new Date("2026-06-03T12:00:00.000Z");
    expect(isResponseExpired(deadline, now)).toBe(false);
  });

  it("never expires when there is no deadline", () => {
    const now = new Date("2099-01-01T00:00:00.000Z");
    expect(isResponseExpired(null, now)).toBe(false);
  });
});

describe("assertResponseIsOpen", () => {
  it.each(OPEN_STATUSES)("does not throw when status is %s", (status) => {
    expect(() => assertResponseIsOpen(status)).not.toThrow();
  });

  it("throws the candidate-facing 'already submitted' message when status is scored", () => {
    expect(() => assertResponseIsOpen("scored")).toThrow(ScreeningResponseError);
    expect(() => assertResponseIsOpen("scored")).toThrow(
      "Your answers have already been submitted and reviewed. Thank you!",
    );
  });

  it("throws the candidate-facing 'expired' message when status is expired", () => {
    expect(() => assertResponseIsOpen("expired")).toThrow(ScreeningResponseError);
    expect(() => assertResponseIsOpen("expired")).toThrow(
      "This link has expired. Please contact the hiring team for a new one.",
    );
  });
});

describe("assertResponseNotResubmitted", () => {
  it.each(OPEN_STATUSES)("does not throw for %s (submission is allowed)", (status) => {
    expect(() => assertResponseNotResubmitted(status)).not.toThrow();
  });

  it("does not throw for expired (the load path blocks that earlier)", () => {
    expect(() => assertResponseNotResubmitted("expired")).not.toThrow();
  });

  it("throws the 'cannot re-submit' message when status is scored", () => {
    expect(() => assertResponseNotResubmitted("scored")).toThrow(ScreeningResponseError);
    expect(() => assertResponseNotResubmitted("scored")).toThrow(
      "Your answers have already been submitted. You cannot re-submit.",
    );
  });
});

describe("assertEligibleForScreeningSend", () => {
  it.each(SCREENING_SEND_ELIGIBLE_STATES)(
    "does not throw for eligible state %s",
    (status) => {
      expect(() => assertEligibleForScreeningSend(status)).not.toThrow();
    },
  );

  // States a candidate can be in where they have NOT yet earned a screening
  // send: pre-screening, awaiting human approval, past screening, or terminal.
  const INELIGIBLE_STATES: ApplicationState[] = [
    "new",
    "screening_review_pending",
    "screening_completed",
    "screening_scored",
    "interview_invited",
    "interview_scheduling",
    "interview_scheduled",
    "interview_completed",
    "interview_scored",
    "reference_check",
    "manager_review",
    "final_interview_scheduling",
    "rejected",
    "hired",
    "archived",
  ];

  it.each(INELIGIBLE_STATES)("throws for ineligible state %s", (status) => {
    expect(() => assertEligibleForScreeningSend(status)).toThrow();
  });

  it("names the offending state in the error message", () => {
    expect(() => assertEligibleForScreeningSend("rejected")).toThrow(
      'currently "rejected"',
    );
  });
});

describe("isEligibleForScreeningSend", () => {
  it.each(SCREENING_SEND_ELIGIBLE_STATES)("returns true for %s", (status) => {
    expect(isEligibleForScreeningSend(status)).toBe(true);
  });

  it("returns false for a pre-screening state", () => {
    expect(isEligibleForScreeningSend("new")).toBe(false);
  });

  it("returns false for a terminal state", () => {
    expect(isEligibleForScreeningSend("rejected")).toBe(false);
  });
});

describe("evaluateScreeningScoringOutcome", () => {
  function makeConfig(
    overrides: Partial<ScreeningScoringConfig> = {},
  ): ScreeningScoringConfig {
    return {
      automation_mode: "fully_auto",
      screening_threshold: 70,
      ...overrides,
    };
  }

  describe("first step is always screening_scored", () => {
    it("records the AI scoring event in HITL mode", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 50 },
        makeConfig({ automation_mode: "human_in_loop" }),
      );

      expect(decisions[0].toState).toBe("screening_scored");
    });

    it("records the AI scoring event in auto-pass mode", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 90 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decisions[0].toState).toBe("screening_scored");
    });

    it("records the AI scoring event in auto-fail mode", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 30 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decisions[0].toState).toBe("screening_scored");
    });
  });

  describe("human_in_loop mode", () => {
    it("rests at screening_scored regardless of score", () => {
      const high = evaluateScreeningScoringOutcome(
        { overall_score: 99 },
        makeConfig({ automation_mode: "human_in_loop", screening_threshold: 50 }),
      );
      const low = evaluateScreeningScoringOutcome(
        { overall_score: 5 },
        makeConfig({ automation_mode: "human_in_loop", screening_threshold: 50 }),
      );

      expect(high).toHaveLength(1);
      expect(low).toHaveLength(1);
    });
  });

  describe("fully_auto mode", () => {
    it("chains screening_scored → interview_invited when score ≥ threshold", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 85 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decisions).toHaveLength(2);
      expect(decisions[1].toState).toBe("interview_invited");
      expect(decisions[1].rationale).toContain("passed");
    });

    it("never routes a pass to the retired slot-booking state (scheduling now follows the AI interview)", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 85 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      for (const d of decisions) {
        expect(d.toState).not.toBe("interview_scheduling");
      }
    });

    it("treats score equal to threshold as a pass (boundary)", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 70 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decisions[1].toState).toBe("interview_invited");
    });

    it("chains screening_scored → rejected when score < threshold", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 40 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 70 }),
      );

      expect(decisions).toHaveLength(2);
      expect(decisions[1].toState).toBe("rejected");
      expect(decisions[1].rationale).toContain("below threshold");
    });
  });

  describe("rationale shape", () => {
    it("includes the overall score and threshold numerically on each step", () => {
      const decisions = evaluateScreeningScoringOutcome(
        { overall_score: 63 },
        makeConfig({ automation_mode: "fully_auto", screening_threshold: 75 }),
      );

      for (const d of decisions) {
        expect(d.rationale).toContain("Screening score 63");
        expect(d.rationale).toContain("threshold 75");
      }
    });
  });
});
