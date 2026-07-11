import { describe, it, expect } from "vitest";
import {
  isRecruiterSettableTarget,
  recruiterStageOptions,
  assertRecruiterSettableTarget,
  SYSTEM_PRODUCED_STATES,
} from "./manual-stage-change";

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

  it("allows interview_invited until the AI-interview invite artifact exists (interim routing decision)", () => {
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

  it("offers the off-platform shortcut to manager_review from interview_invited, but never interview_completed", () => {
    expect(recruiterStageOptions("interview_invited")).toEqual([
      "manager_review",
      "interview_expired",
      "rejected",
    ]);
  });

  it("returns an empty list for a terminal state", () => {
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
