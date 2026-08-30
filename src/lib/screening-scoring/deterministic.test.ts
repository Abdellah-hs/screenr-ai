import { describe, expect, it } from "vitest";
import { calculateScreeningScore } from "./deterministic";
import { EVIDENCE_LEVEL_SCORE } from "@/lib/scoring/evidence-levels";
import type { ScreeningDimension } from "./dimensions";
import type { EvidenceLevel } from "./evidence";
import type { ValidatedScreeningEvidence } from "./validate";

function validated(
  levels: { id: string; level: EvidenceLevel }[],
  warnings: string[] = [],
): ValidatedScreeningEvidence {
  return {
    dimensions: levels.map(({ id, level }) => ({
      dimension_id: id,
      evidence_level: level,
      reported_evidence_level: level,
      evidence_items: [],
      notes: null,
    })),
    extraction_summary: "summary",
    warnings,
  };
}

/** Equal weights unless a test is specifically about weighting. */
function evenDimensions(ids: string[]): ScreeningDimension[] {
  return ids.map((id) => ({ id, name: id, weight: 1 / ids.length }));
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

  it.each(CASES)("scores a %s dimension as %i", (level, expected) => {
    const result = calculateScreeningScore(
      validated([{ id: "d1", level }]),
      evenDimensions(["d1"]),
    );

    expect(result.dimensions[0].score).toBe(expected);
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
    const dims = evenDimensions(["d1"]);
    const a = calculateScreeningScore(validated([{ id: "d1", level: "strong" }]), dims);
    const b = calculateScreeningScore(validated([{ id: "d1", level: "strong" }]), dims);

    expect(a.dimensions[0].score).toBe(b.dimensions[0].score);
    expect(a.overall_score).toBe(b.overall_score);
  });
});

describe("calculateScreeningScore — the overall", () => {
  it("weights each dimension by its share of the rubric", () => {
    const dimensions: ScreeningDimension[] = [
      { id: "d1", name: "Heavy", weight: 0.75 },
      { id: "d2", name: "Light", weight: 0.25 },
    ];

    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "very_strong" }, // 100
        { id: "d2", level: "not_present" }, // 0
      ]),
      dimensions,
    );

    // 100×0.75 + 0×0.25 = 75. An unweighted mean would say 50.
    expect(result.overall_score).toBe(75);
  });

  /**
   * The reason weighting was worth doing: two candidates whose evidence is a
   * mirror image of each other must not score the same, because the rubric says
   * one of those competencies matters three times as much.
   */
  it("separates candidates an unweighted mean would tie", () => {
    const dimensions: ScreeningDimension[] = [
      { id: "d1", name: "Heavy", weight: 0.75 },
      { id: "d2", name: "Light", weight: 0.25 },
    ];

    const strongWhereItCounts = calculateScreeningScore(
      validated([
        { id: "d1", level: "strong" },
        { id: "d2", level: "weak" },
      ]),
      dimensions,
    );
    const strongWhereItDoesNot = calculateScreeningScore(
      validated([
        { id: "d1", level: "weak" },
        { id: "d2", level: "strong" },
      ]),
      dimensions,
    );

    expect(strongWhereItCounts.overall_score).toBeGreaterThan(
      strongWhereItDoesNot.overall_score,
    );
  });

  /**
   * Dropping uncovered dimensions from the denominator would let a candidate
   * who evidenced one competency well and never touched the rest outscore one
   * who covered everything adequately.
   */
  it("counts a dimension the call never covered", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "very_strong" },
        { id: "d2", level: "not_present" },
      ]),
      evenDimensions(["d1", "d2"]),
    );

    expect(result.overall_score).toBe(50);
  });

  it("rescales weights that do not sum to 1, so a flawless call still scores 100", () => {
    // Weights are rounded to 2dp on save: three equal dimensions store 0.33.
    const dimensions: ScreeningDimension[] = [
      { id: "d1", name: "A", weight: 0.33 },
      { id: "d2", name: "B", weight: 0.33 },
      { id: "d3", name: "C", weight: 0.33 },
    ];

    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "very_strong" },
        { id: "d2", level: "very_strong" },
        { id: "d3", level: "very_strong" },
      ]),
      dimensions,
    );

    expect(result.overall_score).toBe(100);
  });

  it("falls back to equal shares when a rubric carries no weights", () => {
    const dimensions: ScreeningDimension[] = [
      { id: "d1", name: "A", weight: 0 },
      { id: "d2", name: "B", weight: 0 },
    ];

    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "very_strong" },
        { id: "d2", level: "not_present" },
      ]),
      dimensions,
    );

    // Not 0: an unweighted rubric means "nobody set weights", not "nothing counts".
    expect(result.overall_score).toBe(50);
  });

  it("scores an empty rubric 0 rather than dividing by nothing", () => {
    expect(calculateScreeningScore(validated([]), []).overall_score).toBe(0);
  });
});

/**
 * Uncovered is not the same as unanswered, and the arithmetic here cannot tell
 * them apart — which is exactly why it must not try.
 *
 * A dimension a candidate WAS asked about and said nothing useful on scores 0
 * and stays in the denominator: that is an honest verdict on an answer. A
 * dimension no question probes scores 0 too, and that one is unfair — but the
 * fix is upstream, in the coverage check that tells the recruiter to go and ask
 * about it. Nothing in this function may special-case it, because from here the
 * two are indistinguishable.
 */
describe("calculateScreeningScore — uncovered vs unanswered", () => {
  const KAFKA = { id: "d1", name: "Kafka", weight: 0.3 };
  const SQL = { id: "d2", name: "SQL", weight: 0.3 };
  const COLLAB = { id: "d3", name: "Collaboration", weight: 0.2 };
  const VALIDATION = { id: "d4", name: "Model Validation", weight: 0.2 };

  it("penalises a candidate for a dimension nobody asked about, if it is left in", () => {
    // The bug this exists to document. Four dimensions, questions covering the
    // first two, a candidate who answers both strongly:
    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "strong" },
        { id: "d2", level: "strong" },
        { id: "d3", level: "not_present" },
        { id: "d4", level: "not_present" },
      ]),
      [KAFKA, SQL, COLLAB, VALIDATION],
    );

    // 80×0.3 + 80×0.3 = 48 — below a 70 threshold, auto-rejected, having
    // answered everything they were actually asked.
    expect(result.overall_score).toBe(48);
  });

  it("scores the same candidate on what they were asked once the rest is excluded", () => {
    // The same two answers, with the unprobed dimensions taken out of scoring
    // by the recruiter and therefore never fetched.
    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "strong" },
        { id: "d2", level: "strong" },
      ]),
      [
        { ...KAFKA, weight: 0.5 },
        { ...SQL, weight: 0.5 },
      ],
    );

    expect(result.overall_score).toBe(80);
  });

  it("still scores a covered dimension 0 when the candidate gave nothing", () => {
    // Excluding must not become a way to launder a bad answer. Collaboration is
    // scored here, the candidate was asked, and said nothing that verified.
    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "strong" },
        { id: "d3", level: "not_present" },
      ]),
      [
        { ...KAFKA, weight: 0.5 },
        { ...COLLAB, weight: 0.5 },
      ],
    );

    expect(result.overall_score).toBe(40);
    expect(result.dimensions[1].score).toBe(0);
  });

  it("still scores a covered dimension low when the evidence is weak", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "strong" },
        { id: "d3", level: "weak" },
      ]),
      [
        { ...KAFKA, weight: 0.5 },
        { ...COLLAB, weight: 0.5 },
      ],
    );

    // 80×0.5 + 25×0.5 — a low score a candidate genuinely earned.
    expect(result.overall_score).toBe(53);
  });

  /**
   * Excluding shifts weight onto what remains rather than leaving a hole: the
   * dimensions that ARE scored share the whole rubric between them.
   */
  it("redistributes the weight of what was removed across what is left", () => {
    const result = calculateScreeningScore(
      validated([
        { id: "d1", level: "very_strong" },
        { id: "d2", level: "very_strong" },
      ]),
      // Stored weights still sum to 0.6 — the excluded two are simply absent.
      [KAFKA, SQL],
    );

    expect(result.overall_score).toBe(100);
  });
});

describe("calculateScreeningScore — structure", () => {
  it("refuses to score when findings and rubric do not line up", () => {
    expect(() =>
      calculateScreeningScore(
        validated([{ id: "d1", level: "strong" }]),
        evenDimensions(["d1", "d2"]),
      ),
    ).toThrow(/rubric dimension/i);
  });

  it("carries the rubric's name onto each scored dimension", () => {
    const dimensions: ScreeningDimension[] = [
      { id: "d1", name: "Distributed systems", weight: 1 },
    ];

    const result = calculateScreeningScore(
      validated([{ id: "d1", level: "strong" }]),
      dimensions,
    );

    expect(result.dimensions[0].name).toBe("Distributed systems");
  });

  it("keeps the level the model reported next to the level that was used", () => {
    const result = calculateScreeningScore(
      {
        dimensions: [
          {
            dimension_id: "d1",
            evidence_level: "unclear",
            reported_evidence_level: "strong",
            evidence_items: [],
            notes: null,
          },
        ],
        extraction_summary: "summary",
        warnings: ["d1: downgraded"],
      },
      evenDimensions(["d1"]),
    );

    expect(result.dimensions[0].score).toBe(0);
    expect(result.dimensions[0].reported_evidence_level).toBe("strong");
  });

  it("passes validation warnings through to the stored result", () => {
    const result = calculateScreeningScore(
      validated([{ id: "d1", level: "strong" }], ["d1: a quote was discarded"]),
      evenDimensions(["d1"]),
    );

    expect(result.validation_warnings).toEqual(["d1: a quote was discarded"]);
  });
});
