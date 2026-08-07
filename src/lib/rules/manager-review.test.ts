import { describe, it, expect } from "vitest";
import {
  MANAGER_REJECTION_CODES,
  MANAGER_REVIEW_DECISIONS,
  assertReviewable,
  managerDecisionDisposition,
  managerDecisionTarget,
  type ManagerReviewDecision,
} from "./manager-review";
import {
  APPLICATION_STATE_TRANSITIONS,
  DISPOSITION_CODES,
  requiresDisposition,
} from "@/lib/constants";

describe("managerDecisionTarget", () => {
  it("routes advance to the final human interview", () => {
    expect(managerDecisionTarget("advance")).toBe("final_interview_scheduling");
  });

  it("routes hire straight to hired", () => {
    expect(managerDecisionTarget("hire")).toBe("hired");
  });

  it("routes reject to rejected", () => {
    expect(managerDecisionTarget("reject")).toBe("rejected");
  });

  // The rule's whole job is naming a legal edge. If the state machine ever drops
  // one of these, this fails here rather than at runtime in front of a recruiter.
  it("only ever names a target the state machine allows out of manager_review", () => {
    const legal = APPLICATION_STATE_TRANSITIONS.manager_review;

    const targets = MANAGER_REVIEW_DECISIONS.map((d) => managerDecisionTarget(d));

    expect(targets.every((t) => legal.includes(t))).toBe(true);
  });

  // Guards against a decision being added to the union without a route, which
  // would otherwise fall through to `undefined` and produce an illegal call.
  it("covers every declared decision", () => {
    for (const decision of MANAGER_REVIEW_DECISIONS) {
      expect(managerDecisionTarget(decision)).toBeTruthy();
    }
  });
});

describe("assertReviewable", () => {
  it("accepts an application sitting in manager_review", () => {
    expect(() => assertReviewable("manager_review")).not.toThrow();
  });

  // A recruiter on a stale tab must not be able to decide on an application
  // that has already moved on — the decision would be recorded against a state
  // that no longer exists.
  it("rejects an application that has already left manager_review", () => {
    expect(() => assertReviewable("hired")).toThrow(/no longer/i);
    expect(() => assertReviewable("rejected")).toThrow(/no longer/i);
  });

  it("rejects an application that never reached manager_review", () => {
    expect(() => assertReviewable("interview_scored")).toThrow(/not yet/i);
    expect(() => assertReviewable("new")).toThrow(/not yet/i);
  });

  // The two messages are different on purpose: "too early" and "too late" are
  // different mistakes and want different fixes from the recruiter.
  it("distinguishes too-early from too-late", () => {
    let early = "";
    let late = "";
    try {
      assertReviewable("interview_scored");
    } catch (e) {
      early = (e as Error).message;
    }
    try {
      assertReviewable("hired");
    } catch (e) {
      late = (e as Error).message;
    }

    expect(early).not.toBe(late);
  });
});

describe("MANAGER_REVIEW_DECISIONS", () => {
  it("offers exactly advance, hire and reject", () => {
    expect([...MANAGER_REVIEW_DECISIONS]).toEqual<ManagerReviewDecision[]>([
      "advance",
      "hire",
      "reject",
    ]);
  });
});

describe("managerDecisionDisposition", () => {
  it("records the manager's own words as the description of a rejection", () => {
    const disposition = managerDecisionDisposition(
      "reject",
      "FAILED_INTERVIEW",
      "System design answers were shallow under follow-up.",
    );

    expect(disposition).toEqual({
      code: "FAILED_INTERVIEW",
      description: "System design answers were shallow under follow-up.",
    });
  });

  it("distinguishes overruling a passing candidate from a weak interview", () => {
    const override = managerDecisionDisposition("reject", "OVERRIDE_REJECTED", "Team fit concern.");

    expect(override?.code).toBe("OVERRIDE_REJECTED");
  });

  it.each(["advance", "hire"] as const)(
    "records nothing for %s, which does not close the application",
    (decision) => {
      const disposition = managerDecisionDisposition(decision, "FAILED_INTERVIEW", "Strong.");

      expect(disposition).toBeUndefined();
    },
  );

  it("supplies a disposition for exactly the decisions that need one", () => {
    // Ties the rule to the state machine: if a decision is ever repointed at
    // a closing state, this fails rather than letting the transition throw at
    // runtime for want of a code.
    for (const decision of MANAGER_REVIEW_DECISIONS) {
      const needed = requiresDisposition(managerDecisionTarget(decision));
      const supplied = managerDecisionDisposition(decision, "FAILED_INTERVIEW", "reason") !== undefined;

      expect(supplied).toBe(needed);
    }
  });

  it("only offers codes the database will accept", () => {
    expect(DISPOSITION_CODES).toEqual(expect.arrayContaining([...MANAGER_REJECTION_CODES]));
  });
});
