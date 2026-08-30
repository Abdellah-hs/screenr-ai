import { describe, expect, it } from "vitest";
import { decisionPrompt } from "./decision-prompt";
import { APPLICATION_STAGE_BUCKET, type ApplicationState } from "@/lib/constants";

const ALL_STATES = Object.keys(APPLICATION_STAGE_BUCKET) as ApplicationState[];

describe("decisionPrompt", () => {
  it("has a prompt for every state in the machine", () => {
    for (const state of ALL_STATES) {
      const prompt = decisionPrompt(state);
      expect(prompt.headline.length, state).toBeGreaterThan(0);
      expect(prompt.detail.length, state).toBeGreaterThan(0);
    }
  });

  it("does not claim a decision is owed while a candidate holds the ball", () => {
    const candidateHolds: ApplicationState[] = [
      "screening_sent",
      "interview_invited",
      "final_interview_scheduling",
    ];

    for (const state of candidateHolds) {
      expect(decisionPrompt(state).waitingOnYou, state).toBe(false);
    }
  });

  it("does not claim a decision is owed on a closed application", () => {
    for (const state of ["hired", "rejected", "archived"] as ApplicationState[]) {
      expect(decisionPrompt(state).waitingOnYou, state).toBe(false);
    }
  });

  it("asks for a decision at every point where nothing else will move it", () => {
    const waiting: ApplicationState[] = [
      "screening_review_pending",
      "screening_scored",
      "interview_scored",
      "manager_review",
    ];

    for (const state of waiting) {
      expect(decisionPrompt(state).waitingOnYou, state).toBe(true);
    }
  });

  it("says a lapsed application was not a rejection", () => {
    for (const state of [
      "screening_expired",
      "interview_expired",
      "interview_no_show",
    ] as ApplicationState[]) {
      expect(decisionPrompt(state).detail.toLowerCase()).toContain("nobody");
    }
  });

  it("says the interview score gated nothing", () => {
    expect(decisionPrompt("interview_scored").detail).toContain("gates nothing");
  });
});
