import { describe, it, expect } from "vitest";
import { buildScreeningInstructions } from "./realtime";

// The Realtime session itself now runs in the agent worker (LiveKit migration);
// what remains here — and what these tests pin — is the instruction composer,
// because the anti-gaming interview design lives in its wording.
describe("buildScreeningInstructions", () => {
  const questions = [
    { prompt: "Tell me about a hard scaling problem you solved.", is_required: true },
    { prompt: "What is your favorite tool and why?", is_required: false },
  ];

  it("includes every question prompt as an internal topic", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toContain("Tell me about a hard scaling problem you solved.");
    expect(out).toContain("What is your favorite tool and why?");
  });

  it("marks required vs optional topics", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/hard scaling problem.*\[required\]/);
    expect(out).toMatch(/favorite tool.*\[optional\]/);
  });

  it("instructs the agent to ask unscripted follow-ups and not read topics verbatim", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out.toLowerCase()).toContain("follow-up");
    expect(out.toLowerCase()).toContain("never read the topics aloud verbatim");
  });

  it("anchors a question to the resume when a summary is provided", () => {
    const out = buildScreeningInstructions({
      questions,
      resumeSummary: "8 years backend, ex-Stripe, Go and Postgres",
    });

    expect(out).toContain("8 years backend, ex-Stripe, Go and Postgres");
  });

  it("names the role when a job title is provided", () => {
    const out = buildScreeningInstructions({ questions, jobTitle: "Senior Backend Engineer" });

    expect(out).toContain("Senior Backend Engineer");
  });

  it("stays coherent with no preset questions", () => {
    const out = buildScreeningInstructions({ questions: [] });

    expect(out).toContain("No preset topics");
    expect(out.toLowerCase()).toContain("follow-up");
  });
});
