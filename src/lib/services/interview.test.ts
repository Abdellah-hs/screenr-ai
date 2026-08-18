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
  INTERVIEW_PERSONAS,
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
 * A campaign could always store an `interview_persona`, but the value never
 * reached the interviewer — every interview ran identically, so the stored
 * setting was a false record of how the candidate was actually interviewed.
 * These tests hold the wire open.
 */
describe("interview persona", () => {
  const PERSONAS = INTERVIEW_PERSONAS.map((p) => p.value);

  it("runs a materially different interview for each persona", () => {
    const outputs = PERSONAS.map((persona) =>
      buildInterviewInstructions({ resume: FULL_RESUME, persona }),
    );

    // Every stance must be distinguishable — a persona that collapses onto
    // another is the bug this issue was filed for, one layer down.
    expect(new Set(outputs).size).toBe(PERSONAS.length);
  });

  it("leaves the default neutral interview byte-identical to the pre-persona prompt", () => {
    // `neutral` was always the baseline stance. If it drifts, every transcript
    // scored before personas shipped stops being comparable with a new one.
    const withoutPersona = buildInterviewInstructions({
      jobTitle: "Backend Engineer",
      resume: FULL_RESUME,
    });
    const explicitlyNeutral = buildInterviewInstructions({
      jobTitle: "Backend Engineer",
      resume: FULL_RESUME,
      persona: "neutral",
    });

    expect(explicitlyNeutral).toBe(withoutPersona);
  });

  it("tells a pressure interviewer to push back on comfortable answers", () => {
    const out = buildInterviewInstructions({
      resume: FULL_RESUME,
      persona: "pressure",
    }).toLowerCase();

    expect(out).toContain("push back");
  });

  it("forbids a socratic interviewer from supplying the answer", () => {
    const out = buildInterviewInstructions({
      resume: FULL_RESUME,
      persona: "socratic",
    }).toLowerCase();

    expect(out).toContain("do not explain");
  });

  it("keeps every persona bound by the no-feedback rule", () => {
    // A stance changes how the interviewer probes, never what it discloses.
    // "Pressure" must not become licence to tell a candidate they're wrong.
    for (const persona of PERSONAS) {
      const out = buildInterviewInstructions({
        resume: FULL_RESUME,
        persona,
      }).toLowerCase();

      expect(out).toContain("do not reveal");
      expect(out).toContain("do not give feedback");
    }
  });

  it("still respects the shared question budget under every persona", () => {
    // The directives are prose the model reads alongside the pacing rules; a
    // persona that dropped the budget would blow the 10-minute cap.
    for (const persona of PERSONAS) {
      const out = buildInterviewInstructions({ resume: FULL_RESUME, persona });

      expect(out).toContain(`about ${INTERVIEW_TARGET_QUESTIONS} main questions`);

      const minuteFigures = [...out.matchAll(/(\d+)(?:\s*[–-]\s*\d+)?\s*minutes?/g)];
      for (const [, figure] of minuteFigures) {
        expect(Number(figure)).toBe(INTERVIEW_DURATION_MINUTES);
      }
    }
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
