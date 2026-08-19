import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { scoreInterview } from "./interview-scoring";
import type { InterviewTranscriptTurn } from "@/lib/data/interview-sessions";

function aiResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

const TRANSCRIPT: InterviewTranscriptTurn[] = [
  { role: "agent", text: "Tell me about your Stripe ledger work.", at: "t1" },
  { role: "candidate", text: "I led the ledger rewrite, cutting reconciliation time by half.", at: "t2" },
  { role: "agent", text: "How did you handle idempotency?", at: "t3" },
  { role: "candidate", text: "We keyed every write on an idempotency token stored in Postgres.", at: "t4" },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
});

describe("scoreInterview", () => {
  it("returns a deterministic zero without calling OpenAI when the candidate never spoke", async () => {
    const agentOnly: InterviewTranscriptTurn[] = [
      { role: "agent", text: "Hello? Are you there?", at: "t1" },
    ];

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: agentOnly,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(evidence.result.overall_score).toBe(0);
    expect(evidence.result.concerns.length).toBeGreaterThan(0);
  });

  it("scores dimensions grounded in the transcript and averages the overall", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 99, // overwritten by the code-side average
        overall_rationale: "Strong systems depth.",
        dimensions: [
          { name: "Technical depth", score: 90, rationale: "Led a ledger rewrite.", evidence_quote: "I led the ledger rewrite" },
          { name: "Correctness", score: 80, rationale: "Idempotency tokens.", evidence_quote: "idempotency token stored in Postgres" },
        ],
        strengths: ["Ledger systems", "Idempotency design"],
        concerns: ["Did not cover team leadership"],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      resumeSummary: "Staff Engineer at Stripe",
      transcript: TRANSCRIPT,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(evidence.result.dimensions).toHaveLength(2);
    // overall is the code-side average of the (grounded) dimension scores, not
    // the model's self-reported 99.
    expect(evidence.result.overall_score).toBe(85);
    expect(evidence.result.strengths).toContain("Ledger systems");
    expect(evidence.promptVersion).toMatch(/interview/);
  });

  it("forces a dimension to 0 when its evidence quote is not in the candidate's speech", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 85,
        overall_rationale: "…",
        dimensions: [
          { name: "Technical depth", score: 90, rationale: "real", evidence_quote: "I led the ledger rewrite" },
          { name: "Leadership", score: 80, rationale: "fabricated", evidence_quote: "I managed a team of twelve engineers" },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: TRANSCRIPT,
    });

    const leadership = evidence.result.dimensions.find((d) => d.name === "Leadership");
    expect(leadership?.score).toBe(0);
    // overall recomputed from corrected scores: (90 + 0) / 2 = 45
    expect(evidence.result.overall_score).toBe(45);
  });

  it("clamps out-of-range scores into 0..100", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 50,
        overall_rationale: "…",
        dimensions: [
          { name: "A", score: 130, rationale: "x", evidence_quote: "I led the ledger rewrite" },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "role",
      transcript: TRANSCRIPT,
    });

    expect(evidence.result.dimensions[0].score).toBe(100);
  });
});

describe("scoreInterview — evidence traceability (#148)", () => {
  it("records which transcript turn each quote came from", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 85,
        overall_rationale: "Strong.",
        dimensions: [
          {
            name: "Technical depth",
            score: 90,
            rationale: "Led a ledger rewrite.",
            evidence_quote: "I led the ledger rewrite",
          },
          {
            name: "Correctness",
            score: 80,
            rationale: "Idempotency tokens.",
            evidence_quote: "idempotency token stored in Postgres",
          },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: TRANSCRIPT,
    });

    // Indices into the FULL transcript, agent turns included — the UI anchors
    // onto rendered turns, so skipping them would link to the wrong line.
    expect(evidence.result.dimensions.map((d) => d.evidence_turn_index)).toEqual([1, 3]);
  });

  it("keeps the quote itself, rather than verifying and discarding it", async () => {
    // The bug this closes: the scorer located the evidence, allowed the score
    // to stand on it, then persisted a number with nothing behind it.
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 90,
        overall_rationale: "Strong.",
        dimensions: [
          {
            name: "Technical depth",
            score: 90,
            rationale: "Led a ledger rewrite.",
            evidence_quote: "I led the ledger rewrite",
          },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: TRANSCRIPT,
    });

    expect(evidence.result.dimensions[0].evidence_quote).toBe("I led the ledger rewrite");
  });

  it("leaves no linkable evidence on a dimension it zeroed for an invented quote", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 80,
        overall_rationale: "Claims leadership.",
        dimensions: [
          {
            name: "Leadership",
            score: 80,
            rationale: "Managed a large team.",
            evidence_quote: "I managed a team of twelve engineers",
          },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: TRANSCRIPT,
    });

    expect(evidence.result.dimensions[0].score).toBe(0);
    expect(evidence.result.dimensions[0].evidence_turn_index).toBeNull();
  });

  it("reports a null index for a dimension the model left unevidenced", async () => {
    // Score 0 with an empty quote is the model's honest "they never showed
    // this". It must render as a finding, not as a broken link.
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 0,
        overall_rationale: "Not demonstrated.",
        dimensions: [
          { name: "System design", score: 0, rationale: "Never came up.", evidence_quote: "" },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: TRANSCRIPT,
    });

    expect(evidence.result.dimensions[0].evidence_quote).toBe("");
    expect(evidence.result.dimensions[0].evidence_turn_index).toBeNull();
  });

  /**
   * A quote the model stitched from two separate answers is still grounded, so
   * it must NOT be demoted — adding the link feature cannot start zeroing
   * scores that previously stood. It simply has no single turn to point at.
   */
  it("keeps a cross-turn quote's score but gives it no anchor", async () => {
    mockCreate.mockResolvedValue(
      aiResponse({
        overall_score: 75,
        overall_rationale: "Broad.",
        dimensions: [
          {
            name: "Breadth",
            score: 75,
            rationale: "Covered both.",
            evidence_quote:
              "cutting reconciliation time by half We keyed every write on an idempotency token",
          },
        ],
        strengths: [],
        concerns: [],
      }),
    );

    const evidence = await scoreInterview({
      jobDescription: "Senior Backend Engineer",
      transcript: TRANSCRIPT,
    });

    expect(evidence.result.dimensions[0].score).toBe(75);
    expect(evidence.result.dimensions[0].evidence_turn_index).toBeNull();
  });
});
