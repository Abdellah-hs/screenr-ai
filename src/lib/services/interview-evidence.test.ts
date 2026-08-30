import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  extractInterviewEvidence,
  INTERVIEW_EVIDENCE_MODEL,
  INTERVIEW_EVIDENCE_PROMPT_VERSION,
} from "./interview-evidence";
import { INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS } from "@/lib/interview-scoring";
import type { InterviewRubricDimension } from "@/lib/interview-scoring";
import type { TranscriptTurn } from "@/lib/scoring/transcript";

/**
 * The wiring around the interview extraction, not the model's judgement.
 *
 * Whether a given answer is `strong` or `partial` is exactly what the model is
 * for and is not testable here. What IS testable, and what these cover, is
 * everything the code does around the call: the silence backstop that must fire
 * without one, that the recruiter's rubric actually reaches the prompt, and
 * that the corpus the model reads is the same string quotes are later verified
 * against.
 */

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

const dimensions: InterviewRubricDimension[] = [
  { id: "dim-1", name: "System design depth", weight: 0.6 },
  { id: "dim-2", name: "Communication", weight: 0.4 },
];

const transcript: TranscriptTurn[] = [
  {
    role: "agent",
    text: "You mentioned rebuilding the ingest pipeline — what broke?",
    at: "2026-08-28T10:00:00.000Z",
  },
  {
    role: "candidate",
    text: "Back-pressure. We had no bound on the queue, so a slow consumer took the writer down with it.",
    at: "2026-08-28T10:00:12.000Z",
  },
];

function aiResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

function evidencePayload() {
  return {
    dimensions: [
      {
        dimension_id: "dim-1",
        evidence_level: "strong",
        evidence_items: [
          { quote: "We had no bound on the queue", turn_index: 1, explanation: "Named the cause." },
        ],
        notes: null,
      },
      {
        dimension_id: "dim-2",
        evidence_level: "partial",
        evidence_items: [],
        notes: null,
      },
    ],
    extraction_summary: "Design depth evidenced; communication only partly.",
  };
}

/** The system prompt the model was actually sent. */
function systemPrompt(): string {
  return mockCreate.mock.calls[0][0].messages[0].content as string;
}

/** The user message — the rubric and the rendered transcript. */
function userPrompt(): string {
  return mockCreate.mock.calls[0][0].messages[1].content as string;
}

beforeEach(() => {
  mockCreate.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
});

describe("extractInterviewEvidence — silence is answered in code", () => {
  /**
   * The rule this exists for: a model handed a transcript with nothing in it
   * fills the silence by inventing answers. So an interview nobody spoke in is
   * reported `not_present` across the board WITHOUT a call being made — and
   * because this is the authoritative backstop for both scoring paths (the
   * auto-score on completion and the recruiter re-score), it has to hold here
   * rather than in either caller.
   */
  it("never calls the model when the candidate never spoke", async () => {
    const result = await extractInterviewEvidence({
      jobDescription: "Senior backend engineer",
      dimensions,
      transcript: transcript.filter((t) => t.role === "agent"),
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it("reports every rubric dimension as not_present, in rubric order", async () => {
    const result = await extractInterviewEvidence({
      jobDescription: "Senior backend engineer",
      dimensions,
      transcript: [],
    });

    expect(result.evidence.dimensions.map((d) => d.dimension_id)).toEqual(["dim-1", "dim-2"]);
    for (const dimension of result.evidence.dimensions) {
      expect(dimension.evidence_level).toBe("not_present");
      expect(dimension.evidence_items).toEqual([]);
    }
  });

  it("skips on a transcript whose only candidate turn is whitespace", async () => {
    const result = await extractInterviewEvidence({
      jobDescription: "Senior backend engineer",
      dimensions,
      transcript: [
        { role: "agent", text: "Are you there?", at: "2026-08-28T10:00:00.000Z" },
        { role: "candidate", text: "   ", at: "2026-08-28T10:00:05.000Z" },
      ],
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  /** The audit row still has to say which rules produced this. */
  it("stamps the skipped result with the model and prompt version", async () => {
    const result = await extractInterviewEvidence({
      jobDescription: "Senior backend engineer",
      dimensions,
      transcript: [],
    });

    expect(result.model).toBe(INTERVIEW_EVIDENCE_MODEL);
    expect(result.promptVersion).toBe(INTERVIEW_EVIDENCE_PROMPT_VERSION);
    expect(result.rawOutput).toContain("no_candidate_speech");
  });

  it("works before the API key is configured, since it makes no call", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript: [] }),
    ).resolves.toMatchObject({ skipped: true });
  });
});

describe("extractInterviewEvidence — the recruiter's rubric reaches the model", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(aiResponse(evidencePayload()));
  });

  /**
   * The bug that motivated this whole prompt version: the retired scorer told
   * the model to "identify the competencies the role actually calls for", and
   * the campaign's rubric was never passed at all — so a rubric the recruiter
   * built and weighted decided nothing while the score implied it had.
   */
  it("lists every rubric dimension, with its id", async () => {
    await extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript });

    expect(userPrompt()).toContain("[dim-1] System design depth");
    expect(userPrompt()).toContain("[dim-2] Communication");
  });

  /** Weighting is applied afterwards, in code. A model shown the weights leans on them. */
  it("never shows the model the weights", async () => {
    await extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript });

    const sent = `${systemPrompt()}\n${userPrompt()}`;
    expect(sent).not.toContain("0.6");
    expect(sent).not.toContain("weight");
  });

  it("sends the interview level definitions, not another stage's", async () => {
    await extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript });

    expect(systemPrompt()).toContain(INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS.strong);
  });

  /**
   * The prompt input and the verification corpus are the same rendering. If
   * they could differ, a quote could be genuinely present in what the model
   * read and still fail to check out.
   */
  it("sends the transcript rendered with both speakers labelled", async () => {
    await extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript });

    expect(userPrompt()).toContain("Candidate: Back-pressure.");
    expect(userPrompt()).toContain("Interviewer: You mentioned rebuilding the ingest pipeline");
  });

  it("includes the résumé summary as context when there is one", async () => {
    await extractInterviewEvidence({
      jobDescription: "Role",
      resumeSummary: "Eight years on data infrastructure.",
      dimensions,
      transcript,
    });

    expect(userPrompt()).toContain("Eight years on data infrastructure.");
    expect(userPrompt()).toContain("context only");
  });

  it("omits the background section entirely when there is no summary", async () => {
    await extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript });

    expect(userPrompt()).not.toContain("Candidate Background");
  });

  it("asks for JSON at a low temperature, so a rerun reads the same way", async () => {
    await extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript });

    const request = mockCreate.mock.calls[0][0];
    expect(request.model).toBe(INTERVIEW_EVIDENCE_MODEL);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.temperature).toBeLessThanOrEqual(0.2);
  });
});

describe("extractInterviewEvidence — handling what comes back", () => {
  it("returns the parsed evidence and the raw output beside it", async () => {
    mockCreate.mockResolvedValue(aiResponse(evidencePayload()));

    const result = await extractInterviewEvidence({
      jobDescription: "Role",
      dimensions,
      transcript,
    });

    expect(result.skipped).toBe(false);
    expect(result.evidence.dimensions[0].evidence_level).toBe("strong");
    expect(JSON.parse(result.rawOutput)).toEqual(evidencePayload());
  });

  it("rejects a response that is not the evidence shape", async () => {
    mockCreate.mockResolvedValue(aiResponse({ overall_score: 82 }));

    await expect(
      extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript }),
    ).rejects.toThrow();
  });

  /** A level outside the shared ladder cannot be mapped to a number. */
  it("rejects an evidence level the ladder does not have", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        dimensions: [
          { dimension_id: "dim-1", evidence_level: "excellent", evidence_items: [], notes: null },
        ],
        extraction_summary: "",
      }),
    );

    await expect(
      extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript }),
    ).rejects.toThrow();
  });

  it("throws rather than return nothing when the model replies empty", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "" } }] });

    await expect(
      extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript }),
    ).rejects.toThrow(/empty response/i);
  });

  it("refuses to run without an API key once there is speech to read", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      extractInterviewEvidence({ jobDescription: "Role", dimensions, transcript }),
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
