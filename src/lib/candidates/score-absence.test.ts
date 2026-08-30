import { describe, expect, it } from "vitest";
import { isLapsedAbsence, scoreAbsenceLabel } from "./score-absence";
import { APPLICATION_STAGE_BUCKET, type ApplicationState } from "@/lib/constants";

const ALL_STATES = Object.keys(APPLICATION_STAGE_BUCKET) as ApplicationState[];

describe("scoreAbsenceLabel", () => {
  it("never renders a dash for any state in the machine", () => {
    for (const state of ALL_STATES) {
      const label = scoreAbsenceLabel(state);
      expect(label, state).not.toBe("—");
      expect(label, state).not.toBe("-");
      expect(label.length, state).toBeGreaterThan(0);
    }
  });

  it("names the lapse rather than the absence when a link died unused", () => {
    expect(scoreAbsenceLabel("screening_expired")).toBe("Screening expired");
    expect(scoreAbsenceLabel("interview_no_show")).toBe("No show");
    expect(scoreAbsenceLabel("processing_failed")).toBe("Processing failed");
  });

  it("distinguishes waiting on the candidate from waiting on the recruiter", () => {
    expect(scoreAbsenceLabel("screening_sent")).toBe("Awaiting the call");
    expect(scoreAbsenceLabel("screening_review_pending")).toBe("Awaiting your approval");
  });

  it("gives each lapse its own words rather than one shared message", () => {
    const lapses = ALL_STATES.filter(isLapsedAbsence).map(scoreAbsenceLabel);

    expect(new Set(lapses).size).toBe(lapses.length);
  });
});

describe("isLapsedAbsence", () => {
  it("counts the four states that stopped without a decision", () => {
    expect(ALL_STATES.filter(isLapsedAbsence).sort()).toEqual([
      "interview_expired",
      "interview_no_show",
      "processing_failed",
      "screening_expired",
    ]);
  });

  it("does not treat a rejection as a lapse — somebody decided that", () => {
    expect(isLapsedAbsence("rejected")).toBe(false);
    expect(isLapsedAbsence("archived")).toBe(false);
  });
});
