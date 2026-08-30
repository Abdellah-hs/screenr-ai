import { describe, expect, it } from "vitest";
import {
  TranscriptEvidenceValidationError,
  UNANSWERED_LEVEL,
  validateTranscriptEvidence,
  type EvidenceResponse,
} from "./transcript-evidence";
import { EVIDENCE_LEVEL_SCORE, type EvidenceLevel } from "./evidence-levels";

/**
 * The validator both spoken stages share.
 *
 * It was covered only through `screening-scoring`, which is the coverage shape
 * that lets a shared module drift: the INTERVIEW depends on the same rules, and
 * one of them (a downgrade lands on `unclear`, never `not_present`) is
 * load-bearing there in a way it is not at the screening stage — see the last
 * describe block. A change made for screening reasons would pass screening's
 * suite and quietly let the interview validator raise a score.
 */

const SPEECH = [
  "We moved billing off a single Postgres box to read replicas.",
  "Month-end reporting queries broke first, which we had never load tested.",
].join("\n");

function finding(
  overrides: Partial<EvidenceResponse["dimensions"][number]> = {},
): EvidenceResponse["dimensions"][number] {
  return {
    dimension_id: "d1",
    evidence_level: "strong",
    evidence_items: [
      {
        quote: "We moved billing off a single Postgres box",
        turn_index: 1,
        explanation: "A concrete scaling change.",
      },
    ],
    notes: null,
    ...overrides,
  };
}

function response(dimensions: EvidenceResponse["dimensions"]): EvidenceResponse {
  return { dimensions, extraction_summary: "One competency covered." };
}

function validate(dimensions: EvidenceResponse["dimensions"], ids: string[] = ["d1"]) {
  return validateTranscriptEvidence({
    response: response(dimensions),
    dimensionIds: ids,
    candidateSpeech: SPEECH,
  });
}

describe("validateTranscriptEvidence — structural failures reject the run", () => {
  it("throws when the finding count does not match the rubric", () => {
    expect(() => validate([finding()], ["d1", "d2"])).toThrow(
      TranscriptEvidenceValidationError,
    );
  });

  it("throws when a dimension is reported twice", () => {
    expect(() =>
      validate([finding({ dimension_id: "d1" }), finding({ dimension_id: "d1" })], ["d1", "d2"]),
    ).toThrow(/more than once/);
  });

  it("throws when a rubric dimension has no finding at all", () => {
    expect(() =>
      validate([finding({ dimension_id: "d1" }), finding({ dimension_id: "unknown" })], [
        "d1",
        "d2",
      ]),
    ).toThrow(/No evidence was returned for dimension d2/);
  });

  /** The findings are re-keyed by id, so the model's ordering cannot misalign them. */
  it("aligns findings to the rubric by id, not by position", () => {
    const result = validate(
      [
        finding({ dimension_id: "d2", evidence_level: "weak", evidence_items: [] }),
        finding({ dimension_id: "d1" }),
      ],
      ["d1", "d2"],
    );

    expect(result.dimensions.map((d) => d.dimension_id)).toEqual(["d1", "d2"]);
    expect(result.dimensions[0].evidence_level).toBe("strong");
  });
});

describe("validateTranscriptEvidence — a claim stands only on a verified quote", () => {
  it("keeps the level when the quote is in the candidate's speech", () => {
    const result = validate([finding()]);

    expect(result.dimensions[0].evidence_level).toBe("strong");
    expect(result.dimensions[0].evidence_items).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("matches a quote across cosmetic differences in punctuation and case", () => {
    const result = validate([
      finding({
        evidence_items: [
          {
            quote: "we moved BILLING off a single Postgres box",
            turn_index: 1,
            explanation: "Same words.",
          },
        ],
      }),
    ]);

    expect(result.dimensions[0].evidence_level).toBe("strong");
  });

  it("discards a quote that is not in the candidate's speech, and says so", () => {
    const result = validate([
      finding({
        evidence_items: [
          { quote: "I rewrote the scheduler in Rust.", turn_index: 1, explanation: "Invented." },
        ],
      }),
    ]);

    expect(result.dimensions[0].evidence_items).toEqual([]);
    expect(result.warnings.join(" ")).toContain("could not be found");
  });

  it("keeps the verified quotes when only some check out", () => {
    const result = validate([
      finding({
        evidence_items: [
          {
            quote: "Month-end reporting queries broke first",
            turn_index: 2,
            explanation: "Real.",
          },
          { quote: "I rewrote the scheduler in Rust.", turn_index: 2, explanation: "Invented." },
        ],
      }),
    ]);

    expect(result.dimensions[0].evidence_level).toBe("strong");
    expect(result.dimensions[0].evidence_items).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("downgrades a level asserted with no quote at all", () => {
    const result = validate([finding({ evidence_level: "very_strong", evidence_items: [] })]);

    expect(result.dimensions[0].evidence_level).toBe("unclear");
    expect(result.dimensions[0].reported_evidence_level).toBe("very_strong");
  });

  it("discards evidence attached to a `not_present` verdict, keeping the verdict", () => {
    const result = validate([finding({ evidence_level: "not_present" })]);

    expect(result.dimensions[0].evidence_level).toBe("not_present");
    expect(result.dimensions[0].evidence_items).toEqual([]);
    expect(result.warnings.join(" ")).toContain("discarded");
  });

  it("records what the model claimed, so a downgrade stays visible", () => {
    const result = validate([finding({ evidence_level: "strong", evidence_items: [] })]);

    expect(result.dimensions[0].reported_evidence_level).toBe("strong");
    expect(result.dimensions[0].evidence_level).toBe("unclear");
  });

  it("passes the extraction summary through untouched", () => {
    expect(validate([finding()]).extraction_summary).toBe("One competency covered.");
  });
});

describe("validateTranscriptEvidence — validation can only ever lower a level", () => {
  const LEVELS: EvidenceLevel[] = [
    "not_present",
    "unclear",
    "weak",
    "partial",
    "strong",
    "very_strong",
  ];

  it.each(LEVELS)("never scores %s higher after validation than before", (level) => {
    const unverifiable = validate([
      finding({
        evidence_level: level,
        evidence_items: [
          { quote: "Nothing they ever said.", turn_index: 0, explanation: "Invented." },
        ],
      }),
    ]);

    expect(EVIDENCE_LEVEL_SCORE[unverifiable.dimensions[0].evidence_level]).toBeLessThanOrEqual(
      EVIDENCE_LEVEL_SCORE[level],
    );
  });

  /**
   * The interview scores only the dimensions the conversation REACHED, and
   * `not_present` is the sole level it drops from the denominator. So a
   * validator that downgraded to `not_present` would not merely lower a
   * dimension — it would remove it, re-normalise the remaining weight across
   * fewer dimensions, and RAISE the candidate's overall score for a claim that
   * failed verification. `unclear` is assessed and scores 0, which is why every
   * downgrade lands there.
   */
  it.each(LEVELS.filter((l) => l !== "not_present"))(
    "downgrades %s to `unclear`, never out of the denominator",
    (level) => {
      const result = validate([
        finding({
          evidence_level: level,
          evidence_items: [
            { quote: "Nothing they ever said.", turn_index: 0, explanation: "Invented." },
          ],
        }),
      ]);

      expect(result.dimensions[0].evidence_level).toBe("unclear");
      expect(result.dimensions[0].evidence_level).not.toBe(UNANSWERED_LEVEL);
    },
  );
});
