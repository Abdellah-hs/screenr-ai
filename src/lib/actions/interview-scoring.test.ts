import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchSession,
  mockSaveScore,
  mockExtractEvidence,
  mockFetchRubricDimensions,
  mockTransitionSystem,
} = vi.hoisted(() => ({
  mockFetchSession: vi.fn(),
  mockSaveScore: vi.fn(),
  mockExtractEvidence: vi.fn(),
  mockFetchRubricDimensions: vi.fn(),
  mockTransitionSystem: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __brand: "admin-client" }),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  fetchInterviewSessionByApplicationId: mockFetchSession,
  saveInterviewScore: mockSaveScore,
}));
vi.mock("@/lib/services/interview-evidence", () => ({
  extractInterviewEvidence: mockExtractEvidence,
}));
vi.mock("@/lib/data/campaigns", () => ({
  fetchInterviewRubricDimensions: mockFetchRubricDimensions,
}));
vi.mock("@/lib/data/transitions", () => ({ transitionApplicationAsSystem: mockTransitionSystem }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The pure layers stay REAL — the validator, the weighted mean and the record-only
// rule. Mocking them would leave this asserting that a mock returned what it was
// told to, and the whole point of the change under test is the arithmetic.
import { runInterviewScoring } from "./interview-scoring";
import { INTERVIEW_PROMPT_VERSION } from "@/lib/services/interview";
import {
  DEFAULT_INTERVIEW_DIMENSIONS,
  INTERVIEW_SCORING_RULES_VERSION,
} from "@/lib/interview-scoring";
import type { DimensionEvidence } from "@/lib/scoring/transcript-evidence";

const ANSWER =
  "I rebuilt the ingest pipeline behind a queue and cut p99 latency from 900ms to 180ms.";

const COMPLETED_SESSION = {
  status: "completed",
  transcript: [
    { role: "agent", text: "Tell me about a system you scaled.", at: "t1" },
    { role: "candidate", text: ANSWER, at: "t2" },
  ],
};

const RUBRIC = [
  { id: "dim-1", name: "Technical depth", weight: 0.5 },
  { id: "dim-2", name: "Communication", weight: 0.5 },
];

/** `strong` (80) and `partial` (55) at equal weight → 67.5, rounded to 68. */
function evidence(
  dimensions: DimensionEvidence[] = [
    {
      dimension_id: "dim-1",
      evidence_level: "strong" as const,
      evidence_items: [{ quote: ANSWER, turn_index: 1, explanation: "Owned the work." }],
      notes: "Clear ownership.",
    },
    {
      dimension_id: "dim-2",
      evidence_level: "partial" as const,
      evidence_items: [{ quote: ANSWER, turn_index: 1, explanation: "Explained clearly." }],
      notes: null,
    },
  ],
) {
  return {
    evidence: { dimensions, extraction_summary: "Covered both competencies." },
    rawOutput: "{}",
    model: "gpt-4o-mini",
    promptVersion: "v2_rubric_dimension_evidence",
    skipped: false,
  };
}

const INPUT = {
  applicationId: "app-1",
  campaignId: "camp-1",
  candidateId: "cand-1",
  ownerUserId: "user-1",
  description: "Senior Backend Engineer",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSession.mockResolvedValue(COMPLETED_SESSION);
  mockExtractEvidence.mockResolvedValue(evidence());
  mockFetchRubricDimensions.mockResolvedValue({ dimensions: RUBRIC, version: 3 });
});

describe("runInterviewScoring", () => {
  it("throws when there is no interview session", async () => {
    mockFetchSession.mockResolvedValue(null);
    await expect(runInterviewScoring(INPUT)).rejects.toThrow(/no interview session/i);
    expect(mockSaveScore).not.toHaveBeenCalled();
  });

  it("throws when the session isn't completed yet", async () => {
    mockFetchSession.mockResolvedValue({ status: "in_progress", transcript: [] });
    await expect(runInterviewScoring(INPUT)).rejects.toThrow(/not ready to score/i);
    expect(mockSaveScore).not.toHaveBeenCalled();
  });

  it("persists the score (with rubric version) and advances to interview_scored", async () => {
    const result = await runInterviewScoring(INPUT);

    expect(mockSaveScore).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-1",
        score: expect.objectContaining({ overall_score: 68, rubric_version: 3 }),
      }),
      expect.objectContaining({ __brand: "admin-client" }),
    );
    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-1",
      "interview_scored",
      expect.stringContaining("68"),
    );
    expect(result).toEqual({ overall_score: 68 });
  });

  /**
   * The point of the 2026-08-28 change. The model reports a LEVEL; the number is
   * this codebase's, derived from the shared ladder and the recruiter's weights.
   */
  it("derives every number from the evidence level, never from the model", async () => {
    await runInterviewScoring(INPUT);

    const { score } = mockSaveScore.mock.calls[0][0];
    expect(score.dimension_scores).toEqual([
      expect.objectContaining({
        dimension_id: "dim-1",
        name: "Technical depth",
        evidence_level: "strong",
        score: 80,
        weight: 0.5,
      }),
      expect.objectContaining({
        dimension_id: "dim-2",
        evidence_level: "partial",
        score: 55,
        weight: 0.5,
      }),
    ]);
    expect(score.rules_version).toBe(INTERVIEW_SCORING_RULES_VERSION);
  });

  /**
   * The recruiter's rubric is what the interview is graded against. The retired
   * scorer told the model to pick its own competencies, and the caller never
   * passed the rubric at all — so a rubric the recruiter had built and weighted
   * decided nothing.
   */
  it("grades against the campaign's interview rubric", async () => {
    await runInterviewScoring(INPUT);

    expect(mockExtractEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: RUBRIC }),
    );
  });

  it("weights dimensions by the recruiter's rubric, not equally", async () => {
    // Same two readings as above, but depth now carries 90% of the score:
    // 80×0.9 + 55×0.1 = 77.5 → 78, against 68 at equal weight.
    mockFetchRubricDimensions.mockResolvedValue({
      dimensions: [
        { id: "dim-1", name: "Technical depth", weight: 0.9 },
        { id: "dim-2", name: "Communication", weight: 0.1 },
      ],
      version: 3,
    });

    const result = await runInterviewScoring(INPUT);

    expect(result).toEqual({ overall_score: 78 });
  });

  /**
   * Never award credit on a quote the candidate did not say. The level is
   * knocked down to `unclear` (0) and what the model claimed is kept, so the
   * correction is visible rather than silent.
   */
  it("downgrades a dimension whose quote is not in the candidate's speech", async () => {
    mockExtractEvidence.mockResolvedValue(
      evidence([
        {
          dimension_id: "dim-1",
          evidence_level: "very_strong" as const,
          evidence_items: [
            { quote: "I led a team of twelve.", turn_index: 1, explanation: "Invented." },
          ],
          notes: null,
        },
        {
          dimension_id: "dim-2",
          evidence_level: "partial" as const,
          evidence_items: [{ quote: ANSWER, turn_index: 1, explanation: "Real." }],
          notes: null,
        },
      ]),
    );

    const result = await runInterviewScoring(INPUT);

    const { score } = mockSaveScore.mock.calls[0][0];
    expect(score.dimension_scores[0]).toMatchObject({
      evidence_level: "unclear",
      reported_evidence_level: "very_strong",
      score: 0,
    });
    // Two warnings, and they say different things: the quote was thrown out,
    // and the level that rested on it was then lowered.
    expect(score.validation_warnings).toEqual([
      expect.stringContaining("could not be found"),
      expect.stringContaining("downgraded"),
    ]);
    // 0×0.5 + 55×0.5 = 27.5 → 28. The invented quote earned nothing.
    expect(result).toEqual({ overall_score: 28 });
  });

  /**
   * A dimension the conversation never reached is left OUT of the score, and
   * how much of the rubric was actually assessed is persisted with it — without
   * that, 100 from one dimension of two is indistinguishable from 100 from both.
   */
  it("excludes an unreached dimension and records the coverage", async () => {
    mockExtractEvidence.mockResolvedValue(
      evidence([
        {
          dimension_id: "dim-1",
          evidence_level: "strong" as const,
          evidence_items: [{ quote: ANSWER, turn_index: 1, explanation: "Real." }],
          notes: null,
        },
        {
          dimension_id: "dim-2",
          evidence_level: "not_present" as const,
          evidence_items: [],
          notes: "Never came up.",
        },
      ]),
    );

    const result = await runInterviewScoring(INPUT);

    // 80, not 40: the unreached dimension is not part of the question.
    expect(result).toEqual({ overall_score: 80 });

    const { score, audit } = mockSaveScore.mock.calls[0][0];
    expect(score.covered_count).toBe(1);
    expect(score.covered_weight).toBe(0.5);
    // Still listed in the breakdown, so the gap is visible.
    expect(score.dimension_scores).toHaveLength(2);
    expect(audit.inputSnapshot.covered_weight).toBe(0.5);
  });

  /**
   * A campaign with no interview rubric is graded by a degenerate rubric through
   * the SAME code path — not by a second scorer, which is a path nobody tests.
   */
  it("falls back to the default competency set when the campaign has no rubric", async () => {
    mockFetchRubricDimensions.mockResolvedValue({ dimensions: [], version: null });
    mockExtractEvidence.mockResolvedValue(
      evidence(
        DEFAULT_INTERVIEW_DIMENSIONS.map((d) => ({
          dimension_id: d.id,
          evidence_level: "strong" as const,
          evidence_items: [{ quote: ANSWER, turn_index: 1, explanation: "e" }],
          notes: null,
        })),
      ),
    );

    const result = await runInterviewScoring(INPUT);

    expect(mockExtractEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: DEFAULT_INTERVIEW_DIMENSIONS }),
    );
    expect(result).toEqual({ overall_score: 80 });
    expect(mockSaveScore.mock.calls[0][0].audit.inputSnapshot.used_default_rubric).toBe(true);
  });

  /**
   * A "pressure" transcript reads very differently from a "collaborative" one.
   * Without the stance on the evidence row, a reviewer reading the score months
   * later can't tell which conversation produced it — and the campaign setting
   * may have been changed since.
   */
  it("records the stance the interview was actually conducted under", async () => {
    await runInterviewScoring({ ...INPUT, persona: "pressure" });

    expect(mockSaveScore).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.objectContaining({
          inputSnapshot: expect.objectContaining({
            interview_persona: "pressure",
            interview_prompt_version: INTERVIEW_PROMPT_VERSION,
          }),
        }),
      }),
      expect.anything(),
    );
  });

  /** A stored score must say which arithmetic and which rubric produced it. */
  it("records the scoring rules version and the rubric it graded against", async () => {
    await runInterviewScoring(INPUT);

    const { inputSnapshot } = mockSaveScore.mock.calls[0][0].audit;
    expect(inputSnapshot.scoring_rules_version).toBe(INTERVIEW_SCORING_RULES_VERSION);
    expect(inputSnapshot.rubric_dimensions).toEqual(RUBRIC);
    expect(inputSnapshot.used_default_rubric).toBe(false);
  });

  /**
   * `manager_review` had no automated entry path at all: every earlier stage
   * auto-advances on a rule and this one stopped, so a fully_auto campaign left
   * scored interviews parked forever.
   */
  it("advances a fully_auto campaign to manager_review after recording the score", async () => {
    await runInterviewScoring({ ...INPUT, automationMode: "fully_auto" });

    expect(mockTransitionSystem).toHaveBeenNthCalledWith(
      1,
      "app-1",
      "interview_scored",
      expect.any(String),
    );
    expect(mockTransitionSystem).toHaveBeenNthCalledWith(
      2,
      "app-1",
      "manager_review",
      expect.any(String),
    );
  });

  it("rests at interview_scored for a human-in-the-loop campaign", async () => {
    await runInterviewScoring({ ...INPUT, automationMode: "human_in_loop" });

    expect(mockTransitionSystem).toHaveBeenCalledOnce();
    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-1",
      "interview_scored",
      expect.any(String),
    );
  });

  it("does not auto-advance when the mode is missing", async () => {
    // Defaulting the other way would silently push candidates past a human.
    await runInterviewScoring(INPUT);

    expect(mockTransitionSystem).toHaveBeenCalledOnce();
  });

  it("records a neutral stance when the campaign never set one", async () => {
    await runInterviewScoring(INPUT);

    expect(mockSaveScore).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.objectContaining({
          inputSnapshot: expect.objectContaining({ interview_persona: "neutral" }),
        }),
      }),
      expect.anything(),
    );
  });
});

/**
 * A re-score refreshes evidence and leaves the pipeline alone.
 *
 * Not merely because re-running the rule would be a no-op: the application has
 * usually already passed `interview_scored`, so it would either fail on an
 * illegal edge or — in `fully_auto` — shove a candidate a manager is actively
 * reviewing back into `manager_review`.
 */
describe("runInterviewScoring in rescore mode", () => {
  it("writes a fresh score without transitioning the application", async () => {
    const result = await runInterviewScoring({ ...INPUT, mode: "rescore" });

    expect(mockSaveScore).toHaveBeenCalledOnce();
    expect(mockTransitionSystem).not.toHaveBeenCalled();
    expect(result).toEqual({ overall_score: 68 });
  });

  it("does not advance a fully_auto campaign either", async () => {
    await runInterviewScoring({
      ...INPUT,
      mode: "rescore",
      automationMode: "fully_auto",
    });

    expect(mockTransitionSystem).not.toHaveBeenCalled();
  });

  it("still transitions on the candidate's own submit", async () => {
    await runInterviewScoring({ ...INPUT, mode: "auto" });

    expect(mockTransitionSystem).toHaveBeenCalledOnce();
  });
});
