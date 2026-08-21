import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { scoreAnswers } from "./screening-questions";

function aiResponse(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
  };
}

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mockCreate.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
  }
});

const sampleQuestions = [
  { id: "q-1", prompt: "Walk me through a hard system design.", is_required: true },
  { id: "q-2", prompt: "What's your debugging approach?", is_required: false },
];

const sampleAnswers = [
  { question_id: "q-1", answer_text: "I led the migration of..." },
  { question_id: "q-2", answer_text: "I start with logs and..." },
];

function answerPayload(overrides: Record<string, unknown> = {}) {
  return {
    overall_score: 72,
    overall_rationale: "Solid answers with concrete examples.",
    answers: [
      { question_id: "q-1", score: 80, rationale: "Specific" },
      { question_id: "q-2", score: 64, rationale: "Generic" },
    ],
    ...overrides,
  };
}

describe("scoreAnswers", () => {
  it("returns audit evidence (rawOutput, model, promptVersion) alongside the normalized result", async () => {
    const payload = answerPayload({ overall_score: 60 });
    mockCreate.mockResolvedValueOnce(aiResponse(payload));

    const evidence = await scoreAnswers({
      jobDescription: "JD",
      questions: sampleQuestions,
      answers: sampleAnswers,
    });

    expect(evidence.rawOutput).toBe(JSON.stringify(payload));
    expect(evidence.model).toBe("gpt-4o-mini");
    expect(evidence.promptVersion).toBe("v2_screening_scoring");
    expect(evidence.result.overall_score).toBe(60);
  });

  it("forces a 0 for a blank answer even if the model scored it, and recomputes the overall", async () => {
    // The model over-credits an empty answer; the deterministic guard must win.
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        answerPayload({
          overall_score: 75,
          answers: [
            { question_id: "q-1", score: 70, rationale: "Model credited a blank" },
            { question_id: "q-2", score: 80, rationale: "Real answer" },
          ],
        }),
      ),
    );

    const evidence = await scoreAnswers({
      jobDescription: "JD",
      questions: sampleQuestions,
      answers: [
        { question_id: "q-1", answer_text: "   " },
        { question_id: "q-2", answer_text: "I start with logs and..." },
      ],
    });

    const scoreById = Object.fromEntries(
      evidence.result.answers.map((a) => [a.question_id, a.score]),
    );
    expect(scoreById["q-1"]).toBe(0);
    expect(scoreById["q-2"]).toBe(80);
    expect(evidence.result.overall_score).toBe(40);
  });

  it("clamps and rounds overall_score and per-answer scores into 0..100", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        answerPayload({
          overall_score: 142.6,
          answers: [
            { question_id: "q-1", score: 200, rationale: "x" },
            { question_id: "q-2", score: -30, rationale: "y" },
          ],
        }),
      ),
    );

    const evidence = await scoreAnswers({
      jobDescription: "JD",
      questions: sampleQuestions,
      answers: sampleAnswers,
    });

    expect(evidence.result.overall_score).toBe(100);
    expect(evidence.result.answers.map((a) => a.score)).toEqual([100, 0]);
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      scoreAnswers({ jobDescription: "JD", questions: sampleQuestions, answers: sampleAnswers }),
    ).rejects.toThrow("OPENAI_API_KEY is not configured");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws when the AI returns an empty content string", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    await expect(
      scoreAnswers({ jobDescription: "JD", questions: sampleQuestions, answers: sampleAnswers }),
    ).rejects.toThrow("OpenAI returned an empty response");
  });
});
