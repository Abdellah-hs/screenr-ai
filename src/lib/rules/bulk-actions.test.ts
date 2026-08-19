import { describe, expect, it } from "vitest";
import { APPLICATION_STATE_TRANSITIONS, type ApplicationState } from "@/lib/constants";
import {
  bulkAdvanceTarget,
  canBulkReject,
  planBulkAction,
  summarizeBulkResult,
  type BulkCandidate,
  type BulkOutcome,
} from "./bulk-actions";

function candidate(
  currentState: ApplicationState,
  applicationId = `app-${currentState}`,
): BulkCandidate {
  return { applicationId, name: `Candidate ${currentState}`, currentState };
}

describe("bulkAdvanceTarget", () => {
  it("moves each stage one step forward", () => {
    expect(bulkAdvanceTarget("new")).toBe("screening_approved");
    expect(bulkAdvanceTarget("screening_review_pending")).toBe("screening_approved");
    expect(bulkAdvanceTarget("screening_scored")).toBe("interview_invited");
    expect(bulkAdvanceTarget("interview_scored")).toBe("manager_review");
    expect(bulkAdvanceTarget("reference_check")).toBe("manager_review");
  });

  /**
   * Bulk moves people up to the decision points, never through them. One
   * rationale spread across fifty candidates is not fifty judgements, and the
   * manager's call is the one the PRD most wants kept individual.
   */
  it("refuses to advance anyone out of manager review", () => {
    expect(bulkAdvanceTarget("manager_review")).toBeNull();
  });

  /**
   * `screening_sent` means an email actually went out. Setting it in bulk would
   * fabricate a sent email for people who never received one.
   */
  it("refuses to fabricate a system-produced state", () => {
    expect(bulkAdvanceTarget("screening_approved")).toBeNull();
  });

  it("has no target from a terminal state", () => {
    for (const state of ["hired", "rejected", "archived"] as const) {
      expect(bulkAdvanceTarget(state)).toBeNull();
    }
  });

  it("has no target while we are waiting on the candidate", () => {
    expect(bulkAdvanceTarget("screening_sent")).toBeNull();
    expect(bulkAdvanceTarget("interview_invited")).toBeNull();
  });

  /**
   * The hand-written map must never propose something the state machine would
   * reject — that would send an illegal move to `transition()` labelled as a
   * planned one.
   */
  it("only ever proposes transitions the state machine allows", () => {
    for (const state of Object.keys(APPLICATION_STATE_TRANSITIONS) as ApplicationState[]) {
      const target = bulkAdvanceTarget(state);
      if (target === null) continue;
      expect(APPLICATION_STATE_TRANSITIONS[state]).toContain(target);
    }
  });
});

describe("canBulkReject", () => {
  it("allows rejection from any open stage", () => {
    for (const state of [
      "new",
      "screening_review_pending",
      "screening_scored",
      "interview_scored",
      "manager_review",
    ] as const) {
      expect(canBulkReject(state)).toBe(true);
    }
  });

  it("refuses to reject an already-closed application", () => {
    for (const state of ["hired", "rejected", "archived"] as const) {
      expect(canBulkReject(state)).toBe(false);
    }
  });
});

describe("planBulkAction — advance", () => {
  it("splits a mixed selection into eligible and skipped", () => {
    const plan = planBulkAction(
      [candidate("screening_scored"), candidate("manager_review"), candidate("hired")],
      "advance",
    );

    expect(plan.eligible.map((e) => e.applicationId)).toEqual(["app-screening_scored"]);
    expect(plan.skipped.map((e) => e.applicationId)).toEqual([
      "app-manager_review",
      "app-hired",
    ]);
  });

  it("names each eligible application's own destination", () => {
    // Different starting states advance to different places — a bulk action is
    // N transitions, not one shared target.
    const plan = planBulkAction(
      [candidate("new"), candidate("screening_scored")],
      "advance",
    );

    expect(plan.eligible.map((e) => e.toState)).toEqual([
      "screening_approved",
      "interview_invited",
    ]);
  });

  /**
   * A generic "not eligible" would leave the recruiter unable to tell whether
   * the system protected them from a mistake or is simply in their way.
   */
  it("gives a distinct reason per kind of skip", () => {
    const plan = planBulkAction(
      [
        candidate("manager_review"),
        candidate("screening_approved"),
        candidate("hired"),
        candidate("screening_sent"),
      ],
      "advance",
    );

    const reasons = plan.skipped.map((s) => s.skipReason);
    expect(new Set(reasons).size).toBe(4);
    expect(reasons[0]).toContain("manager");
    expect(reasons[1]).toContain("Send");
    expect(reasons[2]).toContain("closed");
    expect(reasons[3]).toContain("candidate");
  });

  it("returns an empty plan for an empty selection", () => {
    expect(planBulkAction([], "advance")).toEqual({ eligible: [], skipped: [] });
  });
});

describe("planBulkAction — reject", () => {
  it("targets rejected for every open application", () => {
    const plan = planBulkAction(
      [candidate("screening_scored"), candidate("interview_scored")],
      "reject",
    );

    expect(plan.eligible.every((e) => e.toState === "rejected")).toBe(true);
    expect(plan.skipped).toEqual([]);
  });

  it("skips applications that are already closed", () => {
    const plan = planBulkAction([candidate("rejected"), candidate("hired")], "reject");

    expect(plan.eligible).toEqual([]);
    expect(plan.skipped.map((s) => s.skipReason)).toEqual([
      "Already closed.",
      "Already closed.",
    ]);
  });
});

describe("planBulkAction — talent pool", () => {
  /**
   * A pool entry is a bookmark, not pipeline state. Closed applications are
   * exactly where silver medalists come from, so excluding them would defeat
   * the feature.
   */
  it("accepts every stage, closed ones included", () => {
    const plan = planBulkAction(
      [candidate("rejected"), candidate("hired"), candidate("screening_scored")],
      "talent_pool",
    );

    expect(plan.eligible).toHaveLength(3);
    expect(plan.skipped).toEqual([]);
  });

  it("plans no transition, because pooling is not one", () => {
    const plan = planBulkAction([candidate("rejected")], "talent_pool");

    expect(plan.eligible[0].toState).toBeNull();
  });
});

describe("summarizeBulkResult", () => {
  const outcomes: BulkOutcome[] = [
    { applicationId: "a", name: "A", status: "succeeded", detail: null, toState: "rejected" },
    { applicationId: "b", name: "B", status: "skipped", detail: "Already closed.", toState: null },
    { applicationId: "c", name: "C", status: "failed", detail: "Boom", toState: null },
    { applicationId: "d", name: "D", status: "succeeded", detail: null, toState: "rejected" },
  ];

  it("counts each outcome kind", () => {
    const result = summarizeBulkResult("reject", outcomes);

    expect(result).toMatchObject({ action: "reject", succeeded: 2, skipped: 1, failed: 1 });
  });

  it("keeps every outcome so nothing fails silently", () => {
    expect(summarizeBulkResult("reject", outcomes).outcomes).toHaveLength(4);
  });

  /**
   * Counts are derived from the outcomes rather than tracked alongside them, so
   * the headline number and the list beneath it cannot disagree.
   */
  it("has counts that always add up to the outcome list", () => {
    const r = summarizeBulkResult("reject", outcomes);

    expect(r.succeeded + r.skipped + r.failed).toBe(r.outcomes.length);
  });

  it("summarizes an empty run as all zeroes", () => {
    expect(summarizeBulkResult("advance", [])).toMatchObject({
      succeeded: 0,
      skipped: 0,
      failed: 0,
    });
  });
});
