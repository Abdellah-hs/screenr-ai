import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { checkScreeningQuestionCoverage } from "./screening-coverage";
import type { CoverageDimension } from "@/lib/screening/coverage";

/**
 * These tests check the WIRING, not the model's judgement.
 *
 * Whether "tell me about a disagreement with a teammate" covers "Team
 * communication" is a question about the model, and asserting it against a
 * mocked client would only prove the mock returned what the test told it to.
 * That belongs in an eval. What is testable here is everything our own code
 * does around the call: what goes into the prompt, what is believed coming
 * back, and the two cases answered without calling anyone.
 */

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

const dimensions: CoverageDimension[] = [
  { id: "d1", name: "Scaling experience" },
  { id: "d2", name: "Team communication" },
];

const questions = [
  { prompt: "Tell me about a system you scaled." },
  { prompt: "Why are you interested in working here?" },
];

function aiResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

/** Every dimension ruled covered — the model's answer when nothing is missing. */
function allCovered() {
  return {
    dimensions: dimensions.map((d) => ({
      dimension_id: d.id,
      verdict: "covered",
      covering_question: 1,
      reason: "Question 1 gives an opening.",
    })),
  };
}

function gap(dimensionId: string, reason: string) {
  return {
    dimensions: [
      { dimension_id: dimensionId, verdict: "appears_uncovered", covering_question: null, reason },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
});

describe("checkScreeningQuestionCoverage — what the model is shown", () => {
  it("sends every dimension with its id, and every question", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    await checkScreeningQuestionCoverage({ dimensions, questions });

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("[d1] Scaling experience");
    expect(userMessage).toContain("[d2] Team communication");
    expect(userMessage).toContain("Tell me about a system you scaled.");
    expect(userMessage).toContain("Why are you interested in working here?");
  });

  /**
   * The asymmetry the whole feature rests on. A dimension with no question
   * costs every candidate points; a question with no dimension costs nothing.
   * If the prompt ever loses this, recruiters get nagged about perfectly good
   * motivation questions.
   */
  it("tells the model never to complain about a question that fits no dimension", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    await checkScreeningQuestionCoverage({ dimensions, questions });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/a question that matches no rubric dimension is NOT a problem/i);
  });

  it("tells the model one question may cover several dimensions", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    await checkScreeningQuestionCoverage({ dimensions, questions });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/ONE question routinely covers SEVERAL/i);
    expect(systemPrompt).toMatch(/be generous/i);
  });

  /** A configuration check has no business producing any of these. */
  it("never asks the model for a score, a rating or a ranking", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    await checkScreeningQuestionCoverage({ dimensions, questions });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/never score anyone/i);
    expect(systemPrompt).toMatch(/never return numbers/i);
  });
});

describe("checkScreeningQuestionCoverage — what comes back", () => {
  it("reports a gap the model found, named from the rubric", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(gap("d2", "Nothing asks about working with others.")),
    );

    const result = await checkScreeningQuestionCoverage({ dimensions, questions });

    expect(result.uncoveredDimensions).toEqual([
      {
        dimensionId: "d2",
        dimensionName: "Team communication",
        reason: "Nothing asks about working with others.",
      },
    ]);
  });

  /**
   * The verdict shape earns its keep here. Asking only "which are missing?"
   * let the model skip looking for a match and over-report badly — against a
   * real model it called "Debugging method" uncovered while sitting next to a
   * question about solving a production bug. Ruling on every dimension, and
   * naming the question that covers it, makes it go and find one first.
   */
  it("turns a covered verdict into no gap at all", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    const result = await checkScreeningQuestionCoverage({ dimensions, questions });

    expect(result.uncoveredDimensions).toEqual([]);
  });

  it("asks the model to rule on every dimension, not just list the missing ones", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    await checkScreeningQuestionCoverage({ dimensions, questions });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/exactly one entry per listed dimension/i);
    expect(systemPrompt).toMatch(/covering_question is the 1-based number/i);
  });

  it("discards a gap for a dimension that is not in the rubric", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(gap("invented", "Made up.")),
    );

    const result = await checkScreeningQuestionCoverage({ dimensions, questions });

    expect(result.uncoveredDimensions).toEqual([]);
  });

  it("rejects a response whose shape does not parse", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse({ dimensions: [{ reason: "no verdict" }] }));

    await expect(
      checkScreeningQuestionCoverage({ dimensions, questions }),
    ).rejects.toThrow();
  });

  /**
   * Failing loudly matters more here than usual: a caller that swallowed this
   * would show "everything is covered", which is the one answer this feature
   * must never give without having checked.
   */
  it("throws when the model returns nothing", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    await expect(
      checkScreeningQuestionCoverage({ dimensions, questions }),
    ).rejects.toThrow("empty response");
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      checkScreeningQuestionCoverage({ dimensions, questions }),
    ).rejects.toThrow("OPENAI_API_KEY is not configured");
  });
});

describe("checkScreeningQuestionCoverage — answered without the model", () => {
  it("flags every dimension when there are no questions, without calling out", async () => {
    const result = await checkScreeningQuestionCoverage({ dimensions, questions: [] });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.uncoveredDimensions.map((d) => d.dimensionId)).toEqual(["d1", "d2"]);
  });

  it("treats questions that are all blank as no questions at all", async () => {
    const result = await checkScreeningQuestionCoverage({
      dimensions,
      questions: [{ prompt: "   " }],
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.uncoveredDimensions).toHaveLength(2);
  });

  it("reports nothing when there is no rubric, without calling out", async () => {
    const result = await checkScreeningQuestionCoverage({ dimensions: [], questions });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.uncoveredDimensions).toEqual([]);
  });

  it("ignores a half-typed dimension rather than reporting it as a gap", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(allCovered()));

    await checkScreeningQuestionCoverage({
      dimensions: [...dimensions, { id: "d3", name: "  " }],
      questions,
    });

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).not.toContain("[d3]");
  });
});
