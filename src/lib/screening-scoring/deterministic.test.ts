import { describe, expect, it } from "vitest";
import { calculateScreeningScore } from "./deterministic";
import { EVIDENCE_LEVEL_SCORE } from "@/lib/scoring/evidence-levels";
import type { EvidenceLevel } from "./evidence";
import type { ValidatedScreeningEvidence } from "./validate";

function validated(
  levels: { id: string; level: EvidenceLevel }[],
  warnings: string[] = [],
): ValidatedScreeningEvidence {
  return {
    answers: levels.map(({ id, level }) => ({
      question_id: id,
      evidence_level: level,
      reported_evidence_level: level,
      evidence_items: [],
      notes: null,
    })),
    extraction_summary: "summary",
    warnings,
  };
}

describe("calculateScreeningScore — level to score", () => {
  const CASES: [EvidenceLevel, number][] = [
    ["not_present", 0],
    ["unclear", 0],
    ["weak", 25],
    ["partial", 55],
    ["strong", 80],
    ["very_strong", 100],
  ];

  it.each(CASES)("scores a %s answer as %i", (level, expected) => {
    const result = calculateScreeningScore(validated([{ id: "q1", level }]));

    expect(result.answers[0].score).toBe(expected);
  });

  it("grades on the same ladder as resume screening", () => {
    // Not a restatement of the table: this asserts the two stages read the SAME
    // table, so a "strong" answer and a "strong" CV criterion cannot drift onto
    // different numbers.
    for (const [level, expected] of CASES) {
      expect(EVIDENCE_LEVEL_SCORE[level]).toBe(expected);
    }
  });

  it("takes no number from the model — the level is the only input", () => {
    const a = calculateScreeningScore(validated([{ id: "q1", level: "strong" }]));
    const b = calculateScreeningScore(validated([{ id: "q1", level: "strong" }]));

    expect(a.answers[0].score).toBe(b.answers[0].score);
    expect(a.overall_score).toBe(b.overall_score);
  });
});

describe("calculateScreeningScore — the overall", () => {
  it("averages the per-question scores", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "q1", level: "very_strong" }, // 100
        { id: "q2", level: "strong" }, // 80
      ]),
    );

    expect(result.overall_score).toBe(90);
  });

  it("rounds the average", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "q1", level: "strong" }, // 80
        { id: "q2", level: "partial" }, // 55
        { id: "q3", level: "weak" }, // 25
      ]),
    );

    // 160 / 3 = 53.33…
    expect(result.overall_score).toBe(53);
  });

  /**
   * The invariant worth protecting: dropping unanswered questions from the
   * denominator would let a candidate who answered one question well and
   * skipped four outscore one who answered all five adequately.
   */
  it("counts an unanswered question in the denominator", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "q1", level: "very_strong" }, // 100
        { id: "q2", level: "not_present" }, // 0
        { id: "q3", level: "not_present" }, // 0
        { id: "q4", level: "not_present" }, // 0
      ]),
    );

    expect(result.overall_score).toBe(25);
  });

  it("ranks answering everything adequately above answering one thing perfectly", () => {
    const thorough = calculateScreeningScore(
      validated([
        { id: "q1", level: "partial" },
        { id: "q2", level: "partial" },
        { id: "q3", level: "partial" },
      ]),
    );
    const narrow = calculateScreeningScore(
      validated([
        { id: "q1", level: "very_strong" },
        { id: "q2", level: "not_present" },
        { id: "q3", level: "not_present" },
      ]),
    );

    expect(thorough.overall_score).toBeGreaterThan(narrow.overall_score);
  });

  it("scores a call the candidate never engaged with as 0", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "q1", level: "not_present" },
        { id: "q2", level: "not_present" },
      ]),
    );

    expect(result.overall_score).toBe(0);
  });

  it("treats unclear as no credit, not partial credit", () => {
    const result = calculateScreeningScore(validated([{ id: "q1", level: "unclear" }]));

    expect(result.overall_score).toBe(0);
  });

  it("totals 0 for a campaign with no questions rather than dividing by zero", () => {
    const result = calculateScreeningScore(validated([]));

    expect(result.overall_score).toBe(0);
    expect(Number.isNaN(result.overall_score)).toBe(false);
  });
});

describe("calculateScreeningScore — the audit trail", () => {
  it("carries the validation warnings through to the result", () => {
    const result = calculateScreeningScore(
      validated([{ id: "q1", level: "unclear" }], ["q1: a quote could not be found."]),
    );

    expect(result.validation_warnings).toEqual(["q1: a quote could not be found."]);
  });

  it("keeps the level the model reported alongside the one that was used", () => {
    const input = validated([{ id: "q1", level: "unclear" }]);
    input.answers[0].reported_evidence_level = "very_strong";

    const result = calculateScreeningScore(input);

    expect(result.answers[0].evidence_level).toBe("unclear");
    expect(result.answers[0].reported_evidence_level).toBe("very_strong");
    expect(result.answers[0].score).toBe(0);
  });

  it("preserves the question order it was given", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "q3", level: "weak" },
        { id: "q1", level: "strong" },
        { id: "q2", level: "partial" },
      ]),
    );

    expect(result.answers.map((a) => a.question_id)).toEqual(["q3", "q1", "q2"]);
  });
});
