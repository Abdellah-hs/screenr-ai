import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInterviewInstructions,
  summarizeResumeForInterview,
  type InterviewResume,
} from "./interview";
import {
  INTERVIEW_DURATION_MINUTES,
  INTERVIEW_TARGET_QUESTIONS,
} from "@/lib/constants";

const FULL_RESUME: InterviewResume = {
  fullName: "Ada Lovelace",
  headline: "Senior Backend Engineer",
  summary: "Ten years building distributed payment systems.",
  skills: ["Go", "Kubernetes", "PostgreSQL", "gRPC"],
  experience: [
    {
      company: "Stripe",
      title: "Staff Engineer",
      duration: "2021–2024",
      description: "Led the ledger rewrite.",
    },
    {
      company: "Square",
      title: "Backend Engineer",
      duration: "2018–2021",
      description: "Owned the settlement pipeline.",
    },
  ],
  education: [
    { institution: "MIT", degree: "BSc Computer Science", year_end: "2018" },
  ],
};

describe("summarizeResumeForInterview", () => {
  it("condenses the résumé into a single reference block naming skills and recent roles", () => {
    const summary = summarizeResumeForInterview(FULL_RESUME);

    expect(summary).toContain("Ada Lovelace");
    expect(summary).toContain("Go");
    expect(summary).toContain("Stripe");
    expect(summary).toContain("Staff Engineer");
  });

  it("returns null when there is no usable résumé signal", () => {
    expect(summarizeResumeForInterview(null)).toBeNull();
    expect(summarizeResumeForInterview({})).toBeNull();
  });
});

describe("buildInterviewInstructions", () => {
  it("frames the interviewer around the job title", () => {
    const out = buildInterviewInstructions({
      jobTitle: "Senior Backend Engineer",
      resume: FULL_RESUME,
    });

    expect(out).toContain("Senior Backend Engineer");
  });

  it("grounds the interview in the candidate's actual résumé", () => {
    const out = buildInterviewInstructions({
      jobTitle: "Backend Engineer",
      resume: FULL_RESUME,
    });

    // The agent must have the candidate's real background to draw questions from.
    expect(out).toContain("Stripe");
    expect(out).toContain("Kubernetes");
  });

  it("orders unscripted follow-up probes so rehearsed answers collapse", () => {
    const out = buildInterviewInstructions({ resume: FULL_RESUME }).toLowerCase();

    expect(out).toContain("follow-up");
  });

  it("stays neutral — no scores or feedback leak to the candidate", () => {
    const out = buildInterviewInstructions({ resume: FULL_RESUME }).toLowerCase();

    expect(out).toContain("do not reveal");
  });

  it("falls back to a general background interview when no résumé is available", () => {
    const out = buildInterviewInstructions({ jobTitle: "Backend Engineer", resume: null });

    expect(out).toContain("Backend Engineer");
    expect(out.length).toBeGreaterThan(0);
    // No résumé block, but still a runnable instruction set.
    expect(out.toLowerCase()).toContain("interview");
  });

  it("tailors the focus when a specific format is requested", () => {
    const out = buildInterviewInstructions({
      resume: FULL_RESUME,
      format: "behavioral",
    }).toLowerCase();

    expect(out).toContain("behavioral");
  });
});

/**
 * The interview length is one number that three places must agree on: the
 * client's hard cap, the copy the candidate reads, and the pacing the
 * interviewer is told to keep. They previously drifted — a 20-minute cap against
 * a "10–15 minutes" instruction — which either cuts a candidate off mid-answer
 * or leaves them sitting in silence after the agent has said goodbye.
 */
describe("interview pacing", () => {
  it("tells the interviewer the real length of the call", () => {
    const out = buildInterviewInstructions({ resume: FULL_RESUME });

    expect(out).toContain(`${INTERVIEW_DURATION_MINUTES} minutes`);
  });

  it("gives a question budget, since a realtime model cannot watch a clock", () => {
    const out = buildInterviewInstructions({ resume: FULL_RESUME });

    expect(out).toContain(`about ${INTERVIEW_TARGET_QUESTIONS} main questions`);
  });

  it("orders an immediate wrap-up rather than padding to fill the time", () => {
    const out = buildInterviewInstructions({ resume: FULL_RESUME }).toLowerCase();

    expect(out).toContain("do not pad the interview to fill time");
  });

  it("never states a duration the client would not actually allow", () => {
    // Guards the drift directly: any minute figure in the instructions must be
    // the shared constant, not a second hard-coded number.
    const out = buildInterviewInstructions({ resume: FULL_RESUME });

    const minuteFigures = [...out.matchAll(/(\d+)(?:\s*[–-]\s*\d+)?\s*minutes?/g)];
    expect(minuteFigures.length).toBeGreaterThan(0);
    for (const [, figure] of minuteFigures) {
      expect(Number(figure)).toBe(INTERVIEW_DURATION_MINUTES);
    }
  });

  it("caps the client call at exactly the shared duration", () => {
    // The component owns the hard cut; if it stops deriving from the constant,
    // the candidate's clock and the interviewer's plan part company again.
    const component = readFileSync(
      join(process.cwd(), "src/components/realtime/video-interview.tsx"),
      "utf8",
    );

    expect(component).toContain("const CALL_SECONDS = INTERVIEW_DURATION_MINUTES * 60;");
  });
});
