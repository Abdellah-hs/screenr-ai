import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERVIEW_DIMENSIONS,
  interviewScoringDimensions,
  type InterviewRubricDimension,
} from "./dimensions";
import { calculateInterviewScore } from "./deterministic";
import type { ValidatedTranscriptEvidence } from "@/lib/scoring/transcript-evidence";
import type { EvidenceLevel } from "@/lib/scoring/evidence-levels";

/**
 * The rubric an interview is graded against when the campaign never built one.
 *
 * The load-bearing claim is that this is a degenerate RUBRIC and not a second
 * scorer: a rubric-less campaign has to run through exactly the same arithmetic
 * as every other, or the column ends up holding two different kinds of number.
 * A constant is easy to eyeball; that it survives the real scorer is not, which
 * is what the last block checks.
 */

function evidence(levels: EvidenceLevel[]): ValidatedTranscriptEvidence {
  return {
    dimensions: levels.map((level, i) => ({
      dimension_id: DEFAULT_INTERVIEW_DIMENSIONS[i].id,
      evidence_level: level,
      reported_evidence_level: level,
      evidence_items: [],
      notes: null,
    })),
    extraction_summary: "",
    warnings: [],
  };
}

describe("DEFAULT_INTERVIEW_DIMENSIONS", () => {
  it("is a complete rubric on its own", () => {
    expect(DEFAULT_INTERVIEW_DIMENSIONS.length).toBeGreaterThan(0);
  });

  it("carries weights that already sum to 1", () => {
    const total = DEFAULT_INTERVIEW_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);

    expect(total).toBeCloseTo(1, 10);
  });

  /** A recruiter who did not build a rubric has expressed no preference. */
  it("weights every dimension equally", () => {
    const weights = new Set(DEFAULT_INTERVIEW_DIMENSIONS.map((d) => d.weight));

    expect(weights.size).toBe(1);
  });

  /**
   * The ids are readable slugs rather than UUIDs, and they are namespaced, so a
   * stored score says plainly after the fact that no rubric was used. Nothing
   * joins on them — they only align evidence to dimensions — so the only job
   * they have is being legible in an audit row months later.
   */
  it("namespaces its ids so a stored score admits no rubric was used", () => {
    for (const dimension of DEFAULT_INTERVIEW_DIMENSIONS) {
      expect(dimension.id.startsWith("default:")).toBe(true);
    }
  });

  it("gives every dimension a distinct id and a human name", () => {
    const ids = DEFAULT_INTERVIEW_DIMENSIONS.map((d) => d.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const dimension of DEFAULT_INTERVIEW_DIMENSIONS) {
      expect(dimension.name.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * There is no must-have gate and no threshold on the interview, so the
   * scorer is never handed the fields that would let one exist. Keeping them
   * off the shape is what stops the removed Must-Have control coming back by
   * accident.
   */
  it("carries no gate fields for a threshold to be rebuilt from", () => {
    for (const dimension of DEFAULT_INTERVIEW_DIMENSIONS) {
      expect(Object.keys(dimension).sort()).toEqual(["id", "name", "weight"]);
    }
  });
});

describe("interviewScoringDimensions", () => {
  const recruiterRubric: InterviewRubricDimension[] = [
    { id: "r1", name: "System design", weight: 0.7 },
    { id: "r2", name: "Communication", weight: 0.3 },
  ];

  it("uses the recruiter's rubric when there is one", () => {
    expect(interviewScoringDimensions(recruiterRubric)).toEqual(recruiterRubric);
  });

  it("stands the default set in when the rubric is empty", () => {
    expect(interviewScoringDimensions([])).toEqual(DEFAULT_INTERVIEW_DIMENSIONS);
  });

  it("prefers even a single recruiter dimension over the default set", () => {
    const one = [{ id: "r1", name: "System design", weight: 1 }];

    expect(interviewScoringDimensions(one)).toEqual(one);
  });
});

describe("the default set is a rubric, not a second scorer", () => {
  /**
   * The whole point of the fallback. If this ever needed its own code path,
   * a rubric-less campaign would be graded by arithmetic nobody exercises.
   */
  it("scores a flawless rubric-less interview 100 through the ordinary scorer", () => {
    const result = calculateInterviewScore(
      evidence(["very_strong", "very_strong", "very_strong", "very_strong"]),
      interviewScoringDimensions([]),
    );

    expect(result.overall_score).toBe(100);
    expect(result.covered_count).toBe(DEFAULT_INTERVIEW_DIMENSIONS.length);
  });

  it("averages mixed readings by the equal default weights", () => {
    const result = calculateInterviewScore(
      evidence(["very_strong", "strong", "strong", "strong"]),
      interviewScoringDimensions([]),
    );

    // (100 + 80 + 80 + 80) / 4
    expect(result.overall_score).toBe(85);
  });

  /**
   * The covered-dimensions rule has to apply here too: an interview that never
   * reached a competency is not scored 0 on it just because the rubric was a
   * stand-in the recruiter never chose.
   */
  it("still scores only the dimensions the conversation reached", () => {
    const result = calculateInterviewScore(
      evidence(["strong", "not_present", "not_present", "not_present"]),
      interviewScoringDimensions([]),
    );

    expect(result.overall_score).toBe(80);
    expect(result.covered_count).toBe(1);
    expect(result.covered_weight).toBeCloseTo(0.25, 10);
  });

  it("reports the stand-in ids on the breakdown, so the record is self-describing", () => {
    const result = calculateInterviewScore(
      evidence(["strong", "strong", "strong", "strong"]),
      interviewScoringDimensions([]),
    );

    expect(result.dimensions.map((d) => d.dimension_id)).toEqual(
      DEFAULT_INTERVIEW_DIMENSIONS.map((d) => d.id),
    );
  });
});
