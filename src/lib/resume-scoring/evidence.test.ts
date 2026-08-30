import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LEVEL_DEFINITIONS,
  EvidenceLevelSchema,
  ResumeEvidenceResponseSchema,
  ResumeEvidenceWireSchema,
} from "./evidence";
import { EVIDENCE_LEVEL_SCORE } from "@/lib/scoring/evidence-levels";

/**
 * The shape a model may report resume evidence in.
 *
 * Two schemas exist here for one payload, and the split is the interesting
 * part: OpenAI's strict structured-outputs subset rejects `minimum` /
 * `maximum` / `multipleOf`, so the numeric constraint on
 * `extracted_relevant_months` cannot be sent over the wire. It is enforced on
 * our side instead, by re-parsing with the canonical schema the moment the
 * response arrives. If that re-parse were ever dropped the wire schema would
 * silently become the only check, and a negative or fractional duration would
 * land in a stored audit row as though a CV had stated it.
 */

function item(overrides: Record<string, unknown> = {}) {
  return {
    quote: "Built APIs using TypeScript.",
    source_section: "experience",
    explanation: "A concrete professional example.",
    ...overrides,
  };
}

function criterion(overrides: Record<string, unknown> = {}) {
  return {
    criterion_label: "TypeScript",
    evidence_level: "strong",
    evidence_items: [item()],
    extracted_relevant_months: 18,
    notes: null,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return { criteria: [criterion()], extraction_summary: "One criterion covered.", ...overrides };
}

describe("ResumeEvidenceResponseSchema", () => {
  it("accepts a well-formed extraction", () => {
    expect(ResumeEvidenceResponseSchema.safeParse(response()).success).toBe(true);
  });

  it("accepts a criterion with no evidence and no duration", () => {
    const parsed = ResumeEvidenceResponseSchema.safeParse(
      response({
        criteria: [
          criterion({
            evidence_level: "not_present",
            evidence_items: [],
            extracted_relevant_months: null,
          }),
        ],
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("rejects an evidence level outside the shared ladder", () => {
    const parsed = ResumeEvidenceResponseSchema.safeParse(
      response({ criteria: [criterion({ evidence_level: "excellent" })] }),
    );

    expect(parsed.success).toBe(false);
  });

  it("rejects a source section it does not recognise", () => {
    const parsed = ResumeEvidenceResponseSchema.safeParse(
      response({ criteria: [criterion({ evidence_items: [item({ source_section: "vibes" })] })] }),
    );

    expect(parsed.success).toBe(false);
  });

  /** A duration is a count of months. Neither of these is one. */
  it("rejects a negative duration", () => {
    expect(
      ResumeEvidenceResponseSchema.safeParse(
        response({ criteria: [criterion({ extracted_relevant_months: -6 })] }),
      ).success,
    ).toBe(false);
  });

  it("rejects a fractional duration", () => {
    expect(
      ResumeEvidenceResponseSchema.safeParse(
        response({ criteria: [criterion({ extracted_relevant_months: 4.5 })] }),
      ).success,
    ).toBe(false);
  });

  it("requires the extraction summary", () => {
    const withoutSummary: Record<string, unknown> = { ...response() };
    delete withoutSummary.extraction_summary;

    expect(ResumeEvidenceResponseSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe("ResumeEvidenceWireSchema", () => {
  it("accepts the same well-formed extraction", () => {
    expect(ResumeEvidenceWireSchema.safeParse(response()).success).toBe(true);
  });

  /**
   * The documented asymmetry, asserted in both directions so the reason the two
   * schemas exist stays visible: the wire cannot carry the constraint, so the
   * canonical schema is the only thing enforcing it.
   */
  it("lets a negative duration through, which the canonical schema then catches", () => {
    const negative = response({ criteria: [criterion({ extracted_relevant_months: -6 })] });

    expect(ResumeEvidenceWireSchema.safeParse(negative).success).toBe(true);
    expect(ResumeEvidenceResponseSchema.safeParse(negative).success).toBe(false);
  });

  it("lets a fractional duration through, which the canonical schema then catches", () => {
    const fractional = response({ criteria: [criterion({ extracted_relevant_months: 4.5 })] });

    expect(ResumeEvidenceWireSchema.safeParse(fractional).success).toBe(true);
    expect(ResumeEvidenceResponseSchema.safeParse(fractional).success).toBe(false);
  });

  /** It relaxes the NUMBER only. The vocabulary still has to be the real one. */
  it("still rejects an evidence level outside the ladder", () => {
    expect(
      ResumeEvidenceWireSchema.safeParse(
        response({ criteria: [criterion({ evidence_level: "excellent" })] }),
      ).success,
    ).toBe(false);
  });
});

describe("EVIDENCE_LEVEL_DEFINITIONS", () => {
  /**
   * These are embedded verbatim in the extraction prompt. A level the enum
   * accepts but the prompt never defines is one the model is free to choose
   * without ever being told what it means.
   */
  it("defines every level the schema accepts, and no others", () => {
    expect(Object.keys(EVIDENCE_LEVEL_DEFINITIONS).sort()).toEqual(
      [...EvidenceLevelSchema.options].sort(),
    );
  });

  it("keeps the same keys as the shared score table", () => {
    expect(Object.keys(EVIDENCE_LEVEL_DEFINITIONS).sort()).toEqual(
      Object.keys(EVIDENCE_LEVEL_SCORE).sort(),
    );
  });

  it("gives every level a non-empty definition", () => {
    for (const [level, text] of Object.entries(EVIDENCE_LEVEL_DEFINITIONS)) {
      expect(text.trim().length, `${level} has no definition`).toBeGreaterThan(0);
    }
  });

  /**
   * These are a resume's definitions — they talk about what the DOCUMENT
   * states. The two spoken stages describe the same ladder in terms of what a
   * candidate said, and must never be handed this wording.
   */
  it("describes the document rather than a conversation", () => {
    const all = Object.values(EVIDENCE_LEVEL_DEFINITIONS).join(" ").toLowerCase();

    expect(all).toContain("resume");
    expect(all).not.toContain("transcript");
  });
});
