import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { scoreAnswers, scoreTranscript } from "./screening-questions";
import type { VoiceTranscriptTurn } from "@/lib/data/screening-questions";

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
    expect(evidence.promptVersion).toBe("v1_screening_scoring");
    expect(evidence.result.overall_score).toBe(60);
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

const sampleTranscript: VoiceTranscriptTurn[] = [
  { role: "agent", text: "Walk me through a hard system design.", at: "2026-06-03T10:00:00.000Z" },
  { role: "candidate", text: "I led the migration of our monolith to services...", at: "2026-06-03T10:00:08.000Z" },
  { role: "agent", text: "What's your debugging approach?", at: "2026-06-03T10:01:00.000Z" },
  { role: "candidate", text: "I start with logs and reproduce locally...", at: "2026-06-03T10:01:07.000Z" },
];

describe("scoreTranscript", () => {
  it("returns the same evidence shape as scoreAnswers, tagged with the voice prompt version", async () => {
    const payload = answerPayload({ overall_score: 68 });
    mockCreate.mockResolvedValueOnce(aiResponse(payload));

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.overall_score).toBe(68);
    expect(evidence.rawOutput).toBe(JSON.stringify(payload));
    expect(evidence.model).toBe("gpt-4o-mini");
    expect(evidence.promptVersion).toBe("v1_voice_screening_scoring");
  });

  it("sends the spoken transcript to the model", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(answerPayload()));

    await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    const userMessage = mockCreate.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "user",
    ).content as string;
    expect(userMessage).toContain("I led the migration of our monolith");
    expect(userMessage).toContain("Walk me through a hard system design.");
  });

  it("clamps and rounds scores into 0..100", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        answerPayload({
          overall_score: 130,
          answers: [
            { question_id: "q-1", score: 240, rationale: "x" },
            { question_id: "q-2", score: -10, rationale: "y" },
          ],
        }),
      ),
    );

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.overall_score).toBe(100);
    expect(evidence.result.answers.map((a) => a.score)).toEqual([100, 0]);
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      scoreTranscript({ jobDescription: "JD", questions: sampleQuestions, transcript: sampleTranscript }),
    ).rejects.toThrow("OPENAI_API_KEY is not configured");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws when the AI returns an empty content string", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    await expect(
      scoreTranscript({ jobDescription: "JD", questions: sampleQuestions, transcript: sampleTranscript }),
    ).rejects.toThrow("OpenAI returned an empty response");
  });
});
