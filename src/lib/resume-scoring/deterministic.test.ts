import { describe, it, expect } from "vitest";
import {
  EVIDENCE_LEVEL_SCORE,
  buildDeterministicResumeScore,
  calculateNiceToHaveRanking,
  evaluateEligibility,
  readResumeEvaluation,
  resumeScoreRationale,
  scoreEvidenceLevel,
  scoreValidatedCriteria,
  type ScoredCriterion,
} from "./deterministic";
import { MUST_HAVE_MINIMUM_SCORE, type ResumeCriterion } from "./criteria";
import type { EvidenceLevel } from "./evidence";
import type { ValidatedResumeEvidence } from "./validate";

function criterion(label: string, priority: ResumeCriterion["priority"]): ResumeCriterion {
  return { id: `c-${label}`, label, priority };
}

function scored(
  label: string,
  priority: ResumeCriterion["priority"],
  level: EvidenceLevel,
): ScoredCriterion {
  return {
    id: `c-${label}`,
    label,
    priority,
    evidence_level: level,
    score: scoreEvidenceLevel(level),
    evidence_items: [],
    extracted_relevant_months: null,
    notes: null,
  };
}

/** Validated evidence with one entry per criterion, in order. */
function validatedFor(
  levels: { label: string; level: EvidenceLevel }[],
  warnings: string[] = [],
): ValidatedResumeEvidence {
  return {
    criteria: levels.map(({ label, level }) => ({
      criterion_label: label,
      evidence_level: level,
      reported_evidence_level: level,
      evidence_items: [],
      extracted_relevant_months: null,
      notes: null,
    })),
    extraction_summary: "Summary.",
    warnings,
  };
}

describe("scoreEvidenceLevel", () => {
  it("maps partial to 55 every time", () => {
    expect(scoreEvidenceLevel("partial")).toBe(55);
    expect(scoreEvidenceLevel("partial")).toBe(55);
    expect(EVIDENCE_LEVEL_SCORE.partial).toBe(55);
  });

  it("maps strong to 80 every time", () => {
    expect(scoreEvidenceLevel("strong")).toBe(80);
    expect(scoreEvidenceLevel("strong")).toBe(80);
    expect(EVIDENCE_LEVEL_SCORE.strong).toBe(80);
  });

  it("scores unclear as zero, like not_present — uncertainty earns no credit", () => {
    expect(scoreEvidenceLevel("unclear")).toBe(0);
    expect(scoreEvidenceLevel("not_present")).toBe(0);
  });

  it("maps every level to its fixed score", () => {
    const expected: Record<EvidenceLevel, number> = {
      not_present: 0,
      unclear: 0,
      weak: 25,
      partial: 55,
      strong: 80,
      very_strong: 100,
    };

    for (const [level, score] of Object.entries(expected)) {
      expect(scoreEvidenceLevel(level as EvidenceLevel)).toBe(score);
    }
  });
});

describe("evaluateEligibility", () => {
  it("passes when every must-have clears the minimum", () => {
    const result = evaluateEligibility([
      scored("TypeScript", "must_have", "strong"),
      scored("Next.js", "must_have", "very_strong"),
      scored("SQL", "must_have", "strong"),
    ]);

    expect(result.eligible).toBe(true);
    expect(result.failed_must_haves).toEqual([]);
  });

  it("fails the candidate when one must-have falls short", () => {
    const result = evaluateEligibility([
      scored("TypeScript", "must_have", "strong"),
      scored("Next.js", "must_have", "partial"),
      scored("SQL", "must_have", "strong"),
    ]);

    expect(result.eligible).toBe(false);
    expect(result.failed_must_haves).toHaveLength(1);
    expect(result.failed_must_haves[0]).toMatchObject({
      criterion_label: "Next.js",
      score: 55,
      minimum_score: MUST_HAVE_MINIMUM_SCORE,
      evidence_level: "partial",
    });
  });

  it("reports every failed must-have, not just the first", () => {
    const result = evaluateEligibility([
      scored("TypeScript", "must_have", "weak"),
      scored("Next.js", "must_have", "partial"),
      scored("SQL", "must_have", "strong"),
      scored("Kubernetes", "must_have", "not_present"),
    ]);

    expect(result.eligible).toBe(false);
    expect(result.failed_must_haves.map((f) => f.criterion_label)).toEqual([
      "TypeScript",
      "Next.js",
      "Kubernetes",
    ]);
  });

  it("ignores nice-to-haves entirely when deciding eligibility", () => {
    const result = evaluateEligibility([
      scored("TypeScript", "must_have", "strong"),
      scored("Testing", "nice_to_have", "not_present"),
    ]);

    expect(result.eligible).toBe(true);
    expect(result.failed_must_haves).toEqual([]);
  });
});

describe("calculateNiceToHaveRanking", () => {
  it("returns no score at all for an ineligible candidate", () => {
    const ranking = calculateNiceToHaveRanking(
      [scored("Testing", "nice_to_have", "very_strong")],
      false,
    );

    expect(ranking).toEqual({ ranking_score: null, ranked: false });
  });

  it("returns 100 for an eligible candidate with no nice-to-haves", () => {
    const ranking = calculateNiceToHaveRanking(
      [scored("TypeScript", "must_have", "strong")],
      true,
    );

    expect(ranking).toEqual({ ranking_score: 100, ranked: true });
  });

  it("averages nice-to-have scores and leaves must-haves out of the mean", () => {
    const ranking = calculateNiceToHaveRanking(
      [
        scored("TypeScript", "must_have", "strong"), // 80 — must not count
        scored("Testing", "nice_to_have", "very_strong"), // 100
        scored("Docker", "nice_to_have", "weak"), // 25
      ],
      true,
    );

    // (100 + 25) / 2 = 62.5, rounded to 63. The 80 is absent from the mean.
    expect(ranking).toEqual({ ranking_score: 63, ranked: true });
  });
});

describe("buildDeterministicResumeScore", () => {
  const criteria = [
    criterion("TypeScript", "must_have"),
    criterion("Next.js", "must_have"),
    criterion("Testing", "nice_to_have"),
  ];

  it("refuses to let a very strong nice-to-have rescue a failed must-have", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([
        { label: "TypeScript", level: "strong" }, // 80 → pass
        { label: "Next.js", level: "partial" }, // 55 → fail
        { label: "Testing", level: "very_strong" }, // 100, and irrelevant
      ]),
      criteria,
    );

    expect(result.eligible).toBe(false);
    expect(result.ranking_score).toBeNull();
    expect(result.tier).toBe("ineligible");
    expect(result.failed_must_haves).toHaveLength(1);
    expect(result.failed_must_haves[0]).toMatchObject({
      criterion_label: "Next.js",
      score: 55,
      minimum_score: 60,
    });
  });

  it("ranks an eligible candidate on nice-to-haves alone", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([
        { label: "TypeScript", level: "strong" },
        { label: "Next.js", level: "strong" },
        { label: "Testing", level: "very_strong" },
      ]),
      criteria,
    );

    expect(result.eligible).toBe(true);
    expect(result.ranking_score).toBe(100);
    expect(result.tier).toBe("eligible");
    expect(result.failed_must_haves).toEqual([]);
  });

  it("scores an eligible candidate with no nice-to-haves at 100", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([{ label: "TypeScript", level: "strong" }]),
      [criterion("TypeScript", "must_have")],
    );

    expect(result).toMatchObject({ eligible: true, ranking_score: 100, tier: "eligible" });
  });

  it("gives an ineligible candidate with no nice-to-haves a null ranking score", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([{ label: "TypeScript", level: "weak" }]),
      [criterion("TypeScript", "must_have")],
    );

    expect(result).toMatchObject({ eligible: false, ranking_score: null, tier: "ineligible" });
  });

  it("produces an identical result for identical evidence, run after run", () => {
    const evidence = validatedFor([
      { label: "TypeScript", level: "strong" },
      { label: "Next.js", level: "partial" },
      { label: "Testing", level: "very_strong" },
    ]);

    const first = buildDeterministicResumeScore(evidence, criteria);
    const second = buildDeterministicResumeScore(evidence, criteria);
    const third = buildDeterministicResumeScore(evidence, criteria);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(third)).toBe(JSON.stringify(first));
  });

  it("carries validation warnings through to the result", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([{ label: "TypeScript", level: "strong" }], ["a quote was discarded"]),
      [criterion("TypeScript", "must_have")],
    );

    expect(result.validation_warnings).toEqual(["a quote was discarded"]);
  });
});

describe("scoreValidatedCriteria", () => {
  it("keeps a stated duration as context without letting it move the score", () => {
    const validated: ValidatedResumeEvidence = {
      criteria: [
        {
          criterion_label: "TypeScript",
          evidence_level: "weak",
          reported_evidence_level: "weak",
          evidence_items: [],
          extracted_relevant_months: 96,
          notes: null,
        },
      ],
      extraction_summary: "",
      warnings: [],
    };

    const [result] = scoreValidatedCriteria(validated, [criterion("TypeScript", "must_have")]);

    expect(result.extracted_relevant_months).toBe(96);
    expect(result.score).toBe(25); // eight years claimed, still only weak evidence
  });
});

describe("resumeScoreRationale", () => {
  it("names every failed must-have so the decision reads back", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([
        { label: "TypeScript", level: "strong" },
        { label: "Next.js", level: "partial" },
        { label: "Testing", level: "very_strong" },
      ]),
      [
        criterion("TypeScript", "must_have"),
        criterion("Next.js", "must_have"),
        criterion("Testing", "nice_to_have"),
      ],
    );

    const rationale = resumeScoreRationale(result, "Candidate summary.");

    expect(rationale).toContain("Ineligible");
    expect(rationale).toContain("Next.js");
    expect(rationale).toContain("Candidate summary.");
  });
});

describe("readResumeEvaluation", () => {
  it("round-trips a persisted result", () => {
    const result = buildDeterministicResumeScore(
      validatedFor([{ label: "TypeScript", level: "strong" }]),
      [criterion("TypeScript", "must_have")],
    );

    const stored: unknown = JSON.parse(JSON.stringify(result));

    expect(readResumeEvaluation(stored)).toEqual(result);
  });

  it("returns null for a value that is not a result, rather than throwing", () => {
    expect(readResumeEvaluation(null)).toBeNull();
    expect(readResumeEvaluation({ eligible: "yes" })).toBeNull();
    expect(readResumeEvaluation([{ name: "Next.js", score: 72 }])).toBeNull();
  });
});
