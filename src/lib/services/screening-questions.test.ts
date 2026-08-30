import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  DEFAULT_SCREENING_QUESTION_COUNT,
  MAX_DRAFTED_SCREENING_QUESTIONS,
  MIN_DRAFTED_SCREENING_QUESTIONS,
  generateQuestionsForRole,
  scoreAnswers,
  screeningQuestionCountForRubric,
} from "./screening-questions";

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
  { id: "q-1", prompt: "Walk me through a hard system design." },
  { id: "q-2", prompt: "What's your debugging approach?" },
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


describe("screeningQuestionCountForRubric", () => {
  /**
   * The rule the whole function exists for: the rubric is the scoring unit, so
   * the question set is sized to the rubric rather than to a fixed number.
   */
  it("drafts one question per rubric dimension", () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      expect(screeningQuestionCountForRubric(n)).toBe(n);
    }
  });

  it("never drafts fewer than the floor, however small the rubric", () => {
    // Evidence is read across the whole transcript, so extra questions give a
    // dimension more chances to be evidenced. A two-question call would put
    // half the score on each answer.
    expect(screeningQuestionCountForRubric(1)).toBe(MIN_DRAFTED_SCREENING_QUESTIONS);
    expect(screeningQuestionCountForRubric(2)).toBe(MIN_DRAFTED_SCREENING_QUESTIONS);
  });

  it("caps a large rubric rather than drafting a call nobody finishes", () => {
    // The prompt combines the closest-related dimensions past this point.
    expect(screeningQuestionCountForRubric(12)).toBe(MAX_DRAFTED_SCREENING_QUESTIONS);
    expect(screeningQuestionCountForRubric(40)).toBe(MAX_DRAFTED_SCREENING_QUESTIONS);
  });

  it("falls back to the fixed count when there is no rubric at all", () => {
    expect(screeningQuestionCountForRubric(0)).toBe(DEFAULT_SCREENING_QUESTION_COUNT);
  });

  it("stays within the bound a saved question set is validated against", () => {
    // screeningQuestionsArraySchema caps a saved set at 15; a draft that
    // exceeded it would be un-saveable the moment it was generated.
    expect(MAX_DRAFTED_SCREENING_QUESTIONS).toBeLessThanOrEqual(15);
    expect(MIN_DRAFTED_SCREENING_QUESTIONS).toBeGreaterThanOrEqual(1);
  });
});

describe("generateQuestionsForRole — sizing the set", () => {
  function questionsResponse(n: number) {
    return aiResponse({
      questions: Array.from({ length: n }, (_, i) => ({ prompt: `Question ${i + 1}?` })),
    });
  }

  function promptSentToModel(): string {
    const call = mockCreate.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    return call.messages.map((m) => m.content).join(" ");
  }

  it("asks the model for one question per rubric dimension", async () => {
    mockCreate.mockResolvedValueOnce(questionsResponse(7));

    await generateQuestionsForRole({
      jobDescription: "Senior data engineer, streaming pipelines.",
      rubricDimensions: [
        { name: "Kafka" },
        { name: "SQL" },
        { name: "Collaboration" },
        { name: "Model validation" },
        { name: "Airflow" },
        { name: "Cost awareness" },
        { name: "Incident response" },
      ],
    });

    // Seven dimensions against a fixed five left two of them unprobed, and an
    // unprobed dimension scores 0 for every candidate.
    expect(promptSentToModel()).toContain("exactly 7 questions");
  });

  it("shrinks the set for a small rubric instead of padding it off-rubric", async () => {
    mockCreate.mockResolvedValueOnce(questionsResponse(3));

    await generateQuestionsForRole({
      jobDescription: "Support engineer.",
      rubricDimensions: [{ name: "Troubleshooting" }, { name: "Written comms" }],
    });

    expect(promptSentToModel()).toContain("exactly 3 questions");
  });

  it("tells the model that a spare question must stay on the rubric", async () => {
    mockCreate.mockResolvedValueOnce(questionsResponse(3));

    await generateQuestionsForRole({
      jobDescription: "Support engineer.",
      rubricDimensions: [{ name: "Troubleshooting" }],
    });

    // Three questions for one dimension: the extras must probe it again rather
    // than wander onto topics nothing scores.
    expect(promptSentToModel()).toMatch(/more questions than dimensions/i);
  });

  it("still drafts against the description alone when there is no rubric", async () => {
    mockCreate.mockResolvedValueOnce(questionsResponse(5));

    await generateQuestionsForRole({
      jobDescription: "Support engineer.",
      rubricDimensions: [],
    });

    expect(promptSentToModel()).toContain(
      `exactly ${DEFAULT_SCREENING_QUESTION_COUNT} questions`,
    );
  });

  it("honours an explicit count over the rubric-derived one", async () => {
    mockCreate.mockResolvedValueOnce(questionsResponse(4));

    await generateQuestionsForRole({
      jobDescription: "Support engineer.",
      rubricDimensions: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }],
      count: 4,
    });

    expect(promptSentToModel()).toContain("exactly 4 questions");
  });
});

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
