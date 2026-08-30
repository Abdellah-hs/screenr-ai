import { describe, expect, it } from "vitest";
import { EVIDENCE_LEVEL_SCORE } from "@/lib/scoring/evidence-levels";
import type { ValidatedTranscriptEvidence } from "@/lib/scoring/transcript-evidence";
import { calculateInterviewScore } from "./deterministic";
import {
  DEFAULT_INTERVIEW_DIMENSIONS,
  interviewScoringDimensions,
  type InterviewRubricDimension,
} from "./dimensions";
import { INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS } from "./evidence";
import { SCREENING_EVIDENCE_LEVEL_DEFINITIONS } from "@/lib/screening-scoring";
import type { EvidenceLevel } from "@/lib/scoring/evidence-levels";

function validated(
  levels: Record<string, EvidenceLevel>,
  warnings: string[] = [],
): ValidatedTranscriptEvidence {
  return {
    dimensions: Object.entries(levels).map(([dimension_id, evidence_level]) => ({
      dimension_id,
      evidence_level,
      reported_evidence_level: evidence_level,
      evidence_items: [],
      notes: null,
    })),
    extraction_summary: "summary",
    warnings,
  };
}

function rubric(...weights: number[]): InterviewRubricDimension[] {
  return weights.map((weight, i) => ({ id: `d${i + 1}`, name: `Dim ${i + 1}`, weight }));
}

describe("calculateInterviewScore", () => {
  it("derives each score from the evidence level, not from any model number", () => {
    const result = calculateInterviewScore(
      validated({ d1: "strong", d2: "weak" }),
      rubric(0.5, 0.5),
    );

    expect(result.dimensions.map((d) => d.score)).toEqual([
      EVIDENCE_LEVEL_SCORE.strong,
      EVIDENCE_LEVEL_SCORE.weak,
    ]);
  });

  it("weights the overall by the recruiter's rubric", () => {
    // 80×0.75 + 25×0.25 = 66.25 -> 66. Equal weighting would have given 53.
    const result = calculateInterviewScore(
      validated({ d1: "strong", d2: "weak" }),
      rubric(0.75, 0.25),
    );

    expect(result.overall_score).toBe(66);
  });

  /**
   * Changed 2026-08-28, and it is the one place this scorer diverges from
   * screening's. The interview improvises its questions from the candidate's CV
   * by design, so a dimension nobody asked about is expected rather than an
   * authoring error — scoring it 0 would blame the candidate for a question
   * that was never put to them.
   */
  it("leaves a dimension the interview never reached out of the score", () => {
    const result = calculateInterviewScore(
      validated({ d1: "very_strong", d2: "not_present" }),
      rubric(0.5, 0.5),
    );

    // 100, not 50: the second dimension is not part of the question.
    expect(result.overall_score).toBe(100);
    // But it is still listed, so the breakdown shows what went unasked.
    expect(result.dimensions).toHaveLength(2);
    expect(result.covered_count).toBe(1);
    expect(result.covered_weight).toBe(0.5);
  });

  /**
   * The cost of the rule above, pinned so it cannot be forgotten: a narrow
   * interview outranks a thorough one. That is why coverage travels with the
   * score and is rendered beside it — the remedy is disclosure, not arithmetic,
   * because this stage never gates.
   */
  it("lets a narrow interview outscore a broad one, with coverage saying so", () => {
    const narrow = calculateInterviewScore(
      validated({ d1: "very_strong", d2: "not_present", d3: "not_present" }),
      rubric(1, 1, 1),
    );
    const broad = calculateInterviewScore(
      validated({ d1: "strong", d2: "strong", d3: "strong" }),
      rubric(1, 1, 1),
    );

    expect(narrow.overall_score).toBeGreaterThan(broad.overall_score);
    expect(narrow.covered_weight).toBeLessThan(broad.covered_weight);
    expect(broad.covered_weight).toBe(1);
  });

  /**
   * `unclear` is the level an unverified quote is knocked down to, and it means
   * the candidate DID address the topic. Excluding it would let the validator's
   * own correction raise a score — the one direction validation must never move.
   */
  it("still counts a dimension that was addressed but established nothing", () => {
    const result = calculateInterviewScore(
      validated({ d1: "strong", d2: "unclear" }),
      rubric(0.5, 0.5),
    );

    expect(result.overall_score).toBe(40);
    expect(result.covered_count).toBe(2);
  });

  it("scores 0 when the interview reached nothing at all", () => {
    const result = calculateInterviewScore(
      validated({ d1: "not_present", d2: "not_present" }),
      rubric(0.5, 0.5),
    );

    expect(result.overall_score).toBe(0);
    expect(result.covered_count).toBe(0);
    expect(result.covered_weight).toBe(0);
  });

  /**
   * Re-normalising matters: without it, dropping half the rubric would halve
   * every score rather than removing it from the question.
   */
  it("re-normalises the assessed weights so a full answer still reaches 100", () => {
    const result = calculateInterviewScore(
      validated({ d1: "very_strong", d2: "not_present", d3: "not_present" }),
      rubric(0.2, 0.4, 0.4),
    );

    expect(result.overall_score).toBe(100);
  });

  it("re-normalises weights that do not sum to 1", () => {
    // Three dimensions stored at 0.33 sum to 0.99; a flawless interview must
    // still reach 100 rather than 99.
    const result = calculateInterviewScore(
      validated({ d1: "very_strong", d2: "very_strong", d3: "very_strong" }),
      rubric(0.33, 0.33, 0.33),
    );

    expect(result.overall_score).toBe(100);
  });

  it("falls back to equal shares when a rubric carries no weights at all", () => {
    const result = calculateInterviewScore(
      validated({ d1: "strong", d2: "weak" }),
      rubric(0, 0),
    );

    // Not 0 — an unweighted rubric means "no preference", not "nothing counts".
    expect(result.overall_score).toBe(53);
  });

  it("carries the reported level through so a downgrade stays visible", () => {
    const evidence = validated({ d1: "unclear" });
    evidence.dimensions[0].reported_evidence_level = "strong";

    const result = calculateInterviewScore(evidence, rubric(1));

    expect(result.dimensions[0]).toMatchObject({
      evidence_level: "unclear",
      reported_evidence_level: "strong",
      score: 0,
    });
  });

  it("passes validation warnings through to the stored result", () => {
    const result = calculateInterviewScore(
      validated({ d1: "strong" }, ["d1: a quote could not be found."]),
      rubric(1),
    );

    expect(result.validation_warnings).toEqual(["d1: a quote could not be found."]);
  });

  /**
   * A mismatch means we cannot tell which finding belongs to which dimension, so
   * there is nothing safe to salvage — the same reasoning as the validator's
   * structural errors.
   */
  it("refuses to score when findings and rubric dimensions do not line up", () => {
    expect(() =>
      calculateInterviewScore(validated({ d1: "strong" }), rubric(0.5, 0.5)),
    ).toThrow(/2 rubric dimension\(s\) but 1 validated finding/);
  });
});

describe("interviewScoringDimensions", () => {
  it("uses the recruiter's rubric when there is one", () => {
    const theirs = rubric(0.6, 0.4);
    expect(interviewScoringDimensions(theirs)).toBe(theirs);
  });

  /**
   * Never an empty rubric: `calculateInterviewScore` would return 0, which reads
   * as "this candidate failed" rather than "nobody built a rubric".
   */
  it("substitutes the default competency set when the campaign has none", () => {
    expect(interviewScoringDimensions([])).toBe(DEFAULT_INTERVIEW_DIMENSIONS);
  });

  it("keeps the default set weighted so a flawless interview reaches 100", () => {
    const result = calculateInterviewScore(
      validated(
        Object.fromEntries(
          DEFAULT_INTERVIEW_DIMENSIONS.map((d) => [d.id, "very_strong" as EvidenceLevel]),
        ),
      ),
      DEFAULT_INTERVIEW_DIMENSIONS,
    );

    expect(result.overall_score).toBe(100);
  });
});

describe("INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS", () => {
  /**
   * The interview is the deep stage. Sharing the screening wording would hand
   * out `strong` for clearing a short filter's bar, and the two stages would
   * stop discriminating at the point the interview exists to discriminate.
   */
  it("does not reuse the screening wording", () => {
    for (const level of Object.keys(INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS) as EvidenceLevel[]) {
      expect(INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS[level]).not.toBe(
        SCREENING_EVIDENCE_LEVEL_DEFINITIONS[level],
      );
    }
  });

  it("defines every rung of the shared ladder", () => {
    expect(Object.keys(INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS).sort()).toEqual(
      Object.keys(EVIDENCE_LEVEL_SCORE).sort(),
    );
  });
});
