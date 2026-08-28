import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  extractTranscriptEvidence,
  SCREENING_EVIDENCE_PROMPT_VERSION,
} from "./screening-evidence";
import type { TranscriptTurn } from "@/lib/screening-scoring";

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

const questions = [
  { id: "q-1", prompt: "Walk me through a hard system design." },
  { id: "q-2", prompt: "What is your debugging approach?" },
];

const dimensions = [
  { id: "dim-1", name: "System design depth", weight: 0.6 },
  { id: "dim-2", name: "Debugging method", weight: 0.4 },
];

const transcript: TranscriptTurn[] = [
  { role: "agent", text: "Walk me through a hard system design.", at: "2026-06-03T10:00:00.000Z" },
  {
    role: "candidate",
    text: "I led the migration of our monolith to services over eight months.",
    at: "2026-06-03T10:00:08.000Z",
  },
  { role: "agent", text: "What is your debugging approach?", at: "2026-06-03T10:01:00.000Z" },
  {
    role: "candidate",
    text: "I start with logs and reproduce locally before changing anything.",
    at: "2026-06-03T10:01:07.000Z",
  },
];

function aiResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

function evidencePayload(overrides: Record<string, unknown> = {}) {
  return {
    dimensions: [
      {
        dimension_id: "dim-1",
        evidence_level: "strong",
        evidence_items: [
          {
            quote: "I led the migration of our monolith to services",
            turn_index: 1,
            explanation: "Owned a substantial migration.",
          },
        ],
        notes: "Concrete ownership of a large change.",
      },
      {
        dimension_id: "dim-2",
        evidence_level: "partial",
        evidence_items: [
          {
            quote: "I start with logs and reproduce locally",
            turn_index: 3,
            explanation: "A method, briefly described.",
          },
        ],
        notes: null,
      },
    ],
    extraction_summary: "Covered both competencies with concrete detail.",
    ...overrides,
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

describe("extractTranscriptEvidence", () => {
  it("returns the parsed evidence with the audit fields the caller must persist", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    const result = await extractTranscriptEvidence({
      jobDescription: "JD",
      dimensions,
      questions,
      transcript,
    });

    expect(result.evidence.dimensions).toHaveLength(2);
    expect(result.evidence.dimensions[0].evidence_level).toBe("strong");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.promptVersion).toBe(SCREENING_EVIDENCE_PROMPT_VERSION);
    expect(result.rawOutput).toContain("evidence_level");
  });

  it("sends the spoken transcript to the model", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("I led the migration of our monolith");
    expect(userMessage).toContain("Interviewer:");
    expect(userMessage).toContain("Candidate:");
  });

  /**
   * The whole point of the change: if the prompt ever asks for a number again,
   * the model regains the ability to express an opinion as a score and the
   * deterministic layer becomes decorative.
   */
  it("never asks the model for a score", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // Matched loosely on purpose: the instruction has to survive rewording of
    // the prompt around it, and what must never come back is the number.
    expect(systemPrompt).toMatch(/REPORT EVIDENCE/);
    expect(systemPrompt).toMatch(/not to score/);
    expect(systemPrompt).toMatch(/never assign numbers/i);
    expect(systemPrompt).not.toMatch(/0-100/);
  });

  it("defines every evidence level for the model", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    for (const level of ["not_present", "unclear", "weak", "partial", "strong", "very_strong"]) {
      expect(systemPrompt).toContain(`"${level}"`);
    }
  });

  it("tells the model to quote the candidate verbatim and never the interviewer", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/VERBATIM/);
    expect(systemPrompt).toMatch(/Never quote the Interviewer/);
  });

  it("gives the model the rubric to report against", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("[dim-1] System design depth");
    expect(userMessage).toContain("[dim-2] Debugging method");
  });

  /**
   * The rubric carries the recruiter's importance decision as a weight, and the
   * weighting is applied deterministically afterwards. Showing the model the
   * weights would let it lean on them — reporting more generously for the
   * dimension it can see counts for most, which is the model scoring by proxy.
   */
  it("does not show the model how much each dimension is worth", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).not.toContain("0.6");
    expect(userMessage).not.toContain("0.4");
  });

  /**
   * The questions are context for reading the conversation, not the unit being
   * graded. Passing their ids would invite the model to report per question.
   */
  it("supplies the questions as context but not as ids to report on", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("What is your debugging approach?");
    expect(userMessage).not.toContain("[q-1]");
    expect(userMessage).not.toContain("[q-2]");
  });

  /**
   * The behaviour per-question extraction could not express: a competency
   * evidenced while answering some other question still counts.
   */
  it("tells the model to look for each dimension across the whole call", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    await extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript });

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/ANY answer/);
    expect(systemPrompt).toMatch(/do not treat a dimension as covered merely because a question/i);
  });

  it("rejects a response whose shape does not parse", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse({ dimensions: [{ dimension_id: "dim-1", evidence_level: "excellent" }] }),
    );

    await expect(
      extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript }),
    ).rejects.toThrow();
  });

  it("throws when the AI returns an empty content string", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    await expect(
      extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript }),
    ).rejects.toThrow("OpenAI returned an empty response");
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      extractTranscriptEvidence({ jobDescription: "JD", dimensions, questions, transcript }),
    ).rejects.toThrow("OPENAI_API_KEY is not configured");
  });
});

/**
 * A model handed a transcript with no candidate speech fills the silence by
 * inventing answers. This backstop runs before the API call, so there is
 * nothing for it to invent from.
 */
describe("extractTranscriptEvidence — a call nobody spoke in", () => {
  const silent: TranscriptTurn[] = [
    { role: "agent", text: "Walk me through a hard system design.", at: "2026-06-03T10:00:00.000Z" },
    { role: "agent", text: "Are you still there?", at: "2026-06-03T10:00:40.000Z" },
  ];

  it("reports not_present for every dimension without calling the model", async () => {
    const result = await extractTranscriptEvidence({
      jobDescription: "JD",
      dimensions,
      questions,
      transcript: silent,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.evidence.dimensions.map((a) => a.evidence_level)).toEqual([
      "not_present",
      "not_present",
    ]);
  });

  it("attaches no evidence items it would have to invent", async () => {
    const result = await extractTranscriptEvidence({
      jobDescription: "JD",
      dimensions,
      questions,
      transcript: silent,
    });

    expect(result.evidence.dimensions.every((a) => a.evidence_items.length === 0)).toBe(true);
  });

  it("treats a candidate turn of pure whitespace as silence", async () => {
    const result = await extractTranscriptEvidence({
      jobDescription: "JD",
      dimensions,
      questions,
      transcript: [...silent, { role: "candidate", text: "   ", at: "2026-06-03T10:01:00.000Z" }],
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it("still calls the model when the candidate said something real", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evidencePayload()));

    const result = await extractTranscriptEvidence({
      jobDescription: "JD",
      dimensions,
      questions,
      transcript,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(false);
  });
});
