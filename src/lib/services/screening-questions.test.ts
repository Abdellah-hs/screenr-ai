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

const sampleTranscript: VoiceTranscriptTurn[] = [
  { role: "agent", text: "Walk me through a hard system design.", at: "2026-06-03T10:00:00.000Z" },
  { role: "candidate", text: "I led the migration of our monolith to services...", at: "2026-06-03T10:00:08.000Z" },
  { role: "agent", text: "What's your debugging approach?", at: "2026-06-03T10:01:00.000Z" },
  { role: "candidate", text: "I start with logs and reproduce locally...", at: "2026-06-03T10:01:07.000Z" },
];

// Quotes copied verbatim from sampleTranscript's candidate turns, so the
// transcript-evidence verifier treats these payloads as grounded (a no-op).
const GROUNDED_Q1 = "I led the migration of our monolith";
const GROUNDED_Q2 = "I start with logs and reproduce locally";

function voicePayload(overrides: Record<string, unknown> = {}) {
  return {
    overall_score: 68,
    overall_rationale: "Solid spoken answers.",
    answers: [
      { question_id: "q-1", score: 80, rationale: "Strong", evidence_quote: GROUNDED_Q1 },
      { question_id: "q-2", score: 64, rationale: "Decent", evidence_quote: GROUNDED_Q2 },
    ],
    ...overrides,
  };
}

describe("scoreTranscript", () => {
  it("returns the same evidence shape as scoreAnswers, tagged with the voice prompt version", async () => {
    const payload = voicePayload({ overall_score: 68 });
    mockCreate.mockResolvedValueOnce(aiResponse(payload));

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.overall_score).toBe(68);
    expect(evidence.rawOutput).toBe(JSON.stringify(payload));
    expect(evidence.model).toBe("gpt-4o-mini");
    expect(evidence.promptVersion).toBe("v2_voice_screening_scoring");
  });

  it("sends the spoken transcript to the model", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(voicePayload()));

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

  it("requires a verbatim evidence quote per question in the system prompt", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(voicePayload()));

    await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    const systemMessage = mockCreate.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "system",
    ).content as string;
    expect(systemMessage).toContain("evidence_quote");
    expect(systemMessage).toContain("score it exactly 0");
  });

  it("clamps and rounds scores into 0..100", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        voicePayload({
          overall_score: 130,
          answers: [
            { question_id: "q-1", score: 240, rationale: "x", evidence_quote: GROUNDED_Q1 },
            { question_id: "q-2", score: -10, rationale: "y", evidence_quote: GROUNDED_Q2 },
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

  it("forces a 0 for a question whose evidence_quote is empty, and recomputes the overall", async () => {
    // The model scores q-2 without citing any candidate speech — the partial-call
    // bug (a question the candidate never reached should never score above 0).
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        voicePayload({
          overall_score: 55,
          answers: [
            { question_id: "q-1", score: 80, rationale: "Strong", evidence_quote: GROUNDED_Q1 },
            { question_id: "q-2", score: 30, rationale: "General interest", evidence_quote: "" },
          ],
        }),
      ),
    );

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    const scoreById = Object.fromEntries(
      evidence.result.answers.map((a) => [a.question_id, a.score]),
    );
    expect(scoreById["q-1"]).toBe(80);
    expect(scoreById["q-2"]).toBe(0);
    expect(evidence.result.overall_score).toBe(40);
  });

  it("forces a 0 when the cited quote is not present in the candidate's transcript", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        voicePayload({
          answers: [
            { question_id: "q-1", score: 80, rationale: "Strong", evidence_quote: GROUNDED_Q1 },
            {
              question_id: "q-2",
              score: 65,
              rationale: "Claimed expertise",
              evidence_quote: "I have ten years of kubernetes in production",
            },
          ],
        }),
      ),
    );

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    const scoreById = Object.fromEntries(
      evidence.result.answers.map((a) => [a.question_id, a.score]),
    );
    expect(scoreById["q-1"]).toBe(80);
    expect(scoreById["q-2"]).toBe(0);
  });

  it("leaves scores untouched when every quote is grounded in the transcript", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(voicePayload({ overall_score: 72 })));

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.answers.map((a) => a.score)).toEqual([80, 64]);
    expect(evidence.result.overall_score).toBe(72);
  });

  it("scores a transcript with no candidate speech as zero, without calling the model", async () => {
    // Interviewer asked the questions; the candidate never spoke. Scoring this
    // must be a deterministic zero, never an AI call (the model fabricates
    // answers for a silent call).
    const interviewerOnly: VoiceTranscriptTurn[] = [
      { role: "agent", text: "Walk me through a hard system design.", at: "2026-06-03T10:00:00.000Z" },
      { role: "agent", text: "What's your debugging approach?", at: "2026-06-03T10:01:00.000Z" },
    ];

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: interviewerOnly,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(evidence.result.overall_score).toBe(0);
    expect(evidence.result.answers.map((a) => a.score)).toEqual([0, 0]);
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

describe("scoreTranscript — evidence traceability (#148)", () => {
  it("persists the quote and its transcript turn per question", async () => {
    // Before this, the quote was parsed, used to verify the score, and dropped
    // — leaving a per-question number with nothing behind it.
    mockCreate.mockResolvedValueOnce(aiResponse(voicePayload()));

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.answers[0].evidence_quote).toBe(GROUNDED_Q1);
    // Indices into the full transcript, agent turns included.
    expect(evidence.result.answers.map((a) => a.evidence_turn_index)).toEqual([1, 3]);
  });

  it("leaves no evidence on a question it zeroed for an invented quote", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        voicePayload({
          answers: [
            { question_id: "q-1", score: 90, rationale: "Strong", evidence_quote: "I ran a team of twenty" },
            { question_id: "q-2", score: 64, rationale: "Decent", evidence_quote: GROUNDED_Q2 },
          ],
        }),
      ),
    );

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.answers[0].score).toBe(0);
    expect(evidence.result.answers[0].evidence_turn_index).toBeNull();
    expect(evidence.result.answers[0].evidence_quote).toBeUndefined();
  });

  /**
   * The bug this guards: `enforceTranscriptEvidence` used to return the
   * original result untouched when no score changed. With evidence now
   * attached in the same pass, that early return would drop every quote on a
   * fully-grounded response — the common case.
   */
  it("attaches evidence even when no score needed correcting", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(voicePayload()));

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.answers.every((a) => a.evidence_quote)).toBe(true);
    // …and the overall is untouched, since nothing was demoted.
    expect(evidence.result.overall_score).toBe(68);
  });

  it("leaves a legitimately zero-scored question unevidenced", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        voicePayload({
          answers: [
            { question_id: "q-1", score: 0, rationale: "Never addressed", evidence_quote: "" },
            { question_id: "q-2", score: 64, rationale: "Decent", evidence_quote: GROUNDED_Q2 },
          ],
        }),
      ),
    );

    const evidence = await scoreTranscript({
      jobDescription: "JD",
      questions: sampleQuestions,
      transcript: sampleTranscript,
    });

    expect(evidence.result.answers[0].evidence_turn_index).toBeUndefined();
    expect(evidence.result.answers[1].evidence_turn_index).toBe(3);
  });
});
