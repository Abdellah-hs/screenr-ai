import { APPLICATION_STATE_TRANSITIONS } from "@/lib/constants";
import { describe, it, expect } from "vitest";
import {
  isRecruiterSettableTarget,
  recruiterStageOptions,
  assertRecruiterSettableTarget,
  manualStageDisposition,
  SYSTEM_PRODUCED_STATES,
} from "./manual-stage-change";
import { requiresDisposition, type ApplicationState } from "@/lib/constants";

describe("isRecruiterSettableTarget", () => {
  it("blocks every system-produced artifact state", () => {
    for (const state of SYSTEM_PRODUCED_STATES) {
      expect(isRecruiterSettableTarget(state)).toBe(false);
    }
  });

  it("allows routing states a recruiter legitimately owns", () => {
    expect(isRecruiterSettableTarget("rejected")).toBe(true);
    expect(isRecruiterSettableTarget("screening_expired")).toBe(true);
    expect(isRecruiterSettableTarget("interview_no_show")).toBe(true);
    expect(isRecruiterSettableTarget("final_interview_scheduling")).toBe(true);
  });

  it("allows interview_invited — the HITL advancement point, and the transition itself sends the invite", () => {
    expect(isRecruiterSettableTarget("interview_invited")).toBe(true);
  });
});

describe("recruiterStageOptions", () => {
  it("drops screening_completed from the screening_sent options (the reported bug)", () => {
    const options = recruiterStageOptions("screening_sent");

    expect(options).not.toContain("screening_completed");
    expect(options).toEqual(["screening_expired", "rejected"]);
  });

  it("drops screening_sent from the screening_approved options (sending is the Send button's job)", () => {
    const options = recruiterStageOptions("screening_approved");

    expect(options).not.toContain("screening_sent");
    expect(options).toEqual(["rejected"]);
  });

  it("drops screening_scored from the screening_completed options", () => {
    const options = recruiterStageOptions("screening_completed");

    expect(options).not.toContain("screening_scored");
    expect(options).toEqual(["processing_failed", "rejected"]);
  });

  it("drops interview_scheduled from the interview_scheduling options (only the candidate's booking sets it)", () => {
    const options = recruiterStageOptions("interview_scheduling");

    expect(options).not.toContain("interview_scheduled");
    expect(options).toEqual(["rejected"]);
  });

  it("leaves a scored candidate's routing choices intact", () => {
    // screening_scored is reached by the system; from there the recruiter still
    // decides advancement vs rejection — neither is a system-produced state.
    expect(recruiterStageOptions("screening_scored")).toEqual([
      "interview_invited",
      "rejected",
    ]);
  });

  it("lets the recruiter route manager_review into final-interview scheduling", () => {
    expect(recruiterStageOptions("manager_review")).toEqual([
      "final_interview_scheduling",
      "hired",
      "rejected",
    ]);
  });

  it("leaves an invited candidate only the expire/reject exits — never interview_completed, never a shortcut to manager_review", () => {
    expect(recruiterStageOptions("interview_invited")).toEqual([
      "interview_expired",
      "rejected",
    ]);
  });

  /**
   * `archived` gained legal exits in #144 so a manager can bring someone back,
   * but un-archiving must restore the state the application ACTUALLY held —
   * only `unarchiveApplication` can know that, by reading the transitions log.
   * Offering the exits as a free dropdown would let a recruiter pick `hired`
   * for someone who never got past screening.
   */
  it("offers no dropdown options from archived, despite the graph permitting exits", () => {
    expect(APPLICATION_STATE_TRANSITIONS.archived.length).toBeGreaterThan(0);
    expect(recruiterStageOptions("archived")).toEqual([]);
  });
});

describe("assertRecruiterSettableTarget", () => {
  it("throws for a system-produced state", () => {
    expect(() => assertRecruiterSettableTarget("screening_scored")).toThrow(
      /can't be set manually/,
    );
  });

  it("does not throw for a recruiter-settable state", () => {
    expect(() => assertRecruiterSettableTarget("rejected")).not.toThrow();
  });
});

describe("manualStageDisposition", () => {
  it("marks a hand-set rejection as an override and keeps the recruiter's words", () => {
    const disposition = manualStageDisposition("rejected", "Candidate took another offer.");

    expect(disposition).toEqual({
      code: "OVERRIDE_REJECTED",
      description: "Candidate took another offer.",
    });
  });

  it("marks a hand-set archive the same way", () => {
    expect(manualStageDisposition("archived", "Role was cancelled.")?.code).toBe(
      "OVERRIDE_REJECTED",
    );
  });

  it("records nothing for a stage change that leaves the application open", () => {
    expect(manualStageDisposition("screening_approved", "Looks strong.")).toBeUndefined();
    expect(manualStageDisposition("interview_invited", "Advancing.")).toBeUndefined();
  });

  it("covers every closing state a recruiter is allowed to pick", () => {
    // The dropdown's targets are derived from the state machine, so a future
    // closing state would silently arrive here with no disposition and make
    // the transition throw. This catches that at build time instead.
    const settableClosing = (
      ["rejected", "archived", "screening_expired", "interview_no_show"] as ApplicationState[]
    ).filter((state) => isRecruiterSettableTarget(state) && requiresDisposition(state));

    for (const state of settableClosing) {
      expect(manualStageDisposition(state, "reason")).toBeDefined();
    }
  });
});

describe("recovering a processing failure", () => {
  // The recovery edge exists so a CV can be READ again. Offering it as a
  // dropdown choice would move the application to "waiting to be scored" with
  // the identity-only placeholder still in `parsed_data`, and the next scoring
  // sweep would grade that empty parse — a real number, possibly a rejection,
  // for a document nobody opened.
  it("does not offer `new` as a manual override from processing_failed", () => {
    const options = recruiterStageOptions("processing_failed");

    expect(options).not.toContain("new");
    expect(options).toEqual(["archived"]);
  });

  it("blocks a crafted request that tries to set `new` by hand", () => {
    expect(isRecruiterSettableTarget("new")).toBe(false);
  });
});
