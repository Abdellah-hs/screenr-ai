import { describe, it, expect } from "vitest";
import {
  ResumeEvidenceValidationError,
  normalizeForQuoteMatch,
  normalizedIncludes,
  validateResumeEvidence,
} from "./validate";
import type { ResumeCriterion } from "./criteria";
import type { EvidenceLevel, ResumeEvidenceResponse } from "./evidence";

const RESUME = `## Skills
TypeScript, React, PostgreSQL

## Experience
Senior Engineer at Acme (2019-2024)
Built APIs using TypeScript. Implemented unit and integration tests for all services.

Created a personal dashboard with Next.js.`;

function criteria(...labels: [string, ResumeCriterion["priority"]][]): ResumeCriterion[] {
  return labels.map(([label, priority], i) => ({ id: `c${i}`, label, priority }));
}

function evidence(
  entries: { label: string; level: EvidenceLevel; quotes?: string[] }[],
): ResumeEvidenceResponse {
  return {
    criteria: entries.map((entry) => ({
      criterion_label: entry.label,
      evidence_level: entry.level,
      evidence_items: (entry.quotes ?? []).map((quote) => ({
        quote,
        source_section: "experience" as const,
        explanation: "Explanation.",
      })),
      extracted_relevant_months: null,
      notes: null,
    })),
    extraction_summary: "Summary.",
  };
}

describe("normalizeForQuoteMatch", () => {
  it("folds case, curly punctuation and line breaks together", () => {
    expect(normalizeForQuoteMatch("Built  APIs\nusing “TypeScript”.")).toBe(
      'built apis using "typescript".',
    );
  });

  it("keeps genuinely different words apart", () => {
    expect(normalizeForQuoteMatch("TypeScript")).not.toBe(normalizeForQuoteMatch("JavaScript"));
  });
});

describe("normalizedIncludes", () => {
  it("finds a quote whose whitespace and case differ from the source", () => {
    expect(normalizedIncludes(RESUME, "built   apis USING TypeScript.")).toBe(true);
  });

  it("finds a quote that spans a line break in the source", () => {
    expect(normalizedIncludes("Built APIs\nusing TypeScript.", "Built APIs using TypeScript.")).toBe(
      true,
    );
  });

  it("rejects a quote that is not in the source", () => {
    expect(normalizedIncludes(RESUME, "Architected a Kubernetes platform.")).toBe(false);
  });

  it("rejects an empty quote instead of matching everything", () => {
    expect(normalizedIncludes(RESUME, "   ")).toBe(false);
  });
});

describe("validateResumeEvidence", () => {
  it("accepts well-formed evidence whose quotes are all in the resume", () => {
    const validated = validateResumeEvidence(
      evidence([
        { label: "TypeScript", level: "strong", quotes: ["Built APIs using TypeScript."] },
        {
          label: "Testing",
          level: "very_strong",
          quotes: ["Implemented unit and integration tests for all services."],
        },
      ]),
      criteria(["TypeScript", "must_have"], ["Testing", "nice_to_have"]),
      RESUME,
    );

    expect(validated.criteria.map((c) => c.evidence_level)).toEqual(["strong", "very_strong"]);
    expect(validated.warnings).toEqual([]);
  });

  it("rejects a response with the wrong number of criteria", () => {
    expect(() =>
      validateResumeEvidence(
        evidence([{ label: "TypeScript", level: "strong", quotes: ["Built APIs using TypeScript."] }]),
        criteria(["TypeScript", "must_have"], ["Testing", "nice_to_have"]),
        RESUME,
      ),
    ).toThrow(ResumeEvidenceValidationError);
  });

  it("rejects criteria returned out of order", () => {
    expect(() =>
      validateResumeEvidence(
        evidence([
          {
            label: "Testing",
            level: "very_strong",
            quotes: ["Implemented unit and integration tests for all services."],
          },
          { label: "TypeScript", level: "strong", quotes: ["Built APIs using TypeScript."] },
        ]),
        criteria(["TypeScript", "must_have"], ["Testing", "nice_to_have"]),
        RESUME,
      ),
    ).toThrow(/out of order/);
  });

  it("rejects a renamed criterion rather than guessing which one it meant", () => {
    expect(() =>
      validateResumeEvidence(
        evidence([{ label: "Typescript (TS)", level: "strong", quotes: ["Built APIs using TypeScript."] }]),
        criteria(["TypeScript", "must_have"]),
        RESUME,
      ),
    ).toThrow(ResumeEvidenceValidationError);
  });

  it("tolerates surrounding whitespace on a label", () => {
    const validated = validateResumeEvidence(
      evidence([{ label: "  TypeScript ", level: "strong", quotes: ["Built APIs using TypeScript."] }]),
      criteria(["TypeScript", "must_have"]),
      RESUME,
    );

    expect(validated.criteria[0].evidence_level).toBe("strong");
  });

  it("downgrades to unclear when the only quote cannot be found in the resume", () => {
    const validated = validateResumeEvidence(
      evidence([
        { label: "Kubernetes", level: "very_strong", quotes: ["Ran a 200-node Kubernetes fleet."] },
      ]),
      criteria(["Kubernetes", "must_have"]),
      RESUME,
    );

    expect(validated.criteria[0].evidence_level).toBe("unclear");
    expect(validated.criteria[0].reported_evidence_level).toBe("very_strong");
    expect(validated.criteria[0].evidence_items).toEqual([]);
    expect(validated.warnings).toHaveLength(2); // the discarded quote, then the downgrade
  });

  it("downgrades to unclear when a positive level arrives with no quote at all", () => {
    const validated = validateResumeEvidence(
      evidence([{ label: "TypeScript", level: "strong" }]),
      criteria(["TypeScript", "must_have"]),
      RESUME,
    );

    expect(validated.criteria[0].evidence_level).toBe("unclear");
    expect(validated.warnings[0]).toContain("no supporting quote");
  });

  it("keeps the level but drops the bad quote when other quotes verify", () => {
    const validated = validateResumeEvidence(
      evidence([
        {
          label: "TypeScript",
          level: "strong",
          quotes: ["Built APIs using TypeScript.", "Led a team of twelve engineers."],
        },
      ]),
      criteria(["TypeScript", "must_have"]),
      RESUME,
    );

    expect(validated.criteria[0].evidence_level).toBe("strong");
    expect(validated.criteria[0].evidence_items).toHaveLength(1);
    expect(validated.criteria[0].evidence_items[0].quote).toBe("Built APIs using TypeScript.");
    expect(validated.warnings).toHaveLength(1);
  });

  it("discards evidence items attached to a not_present verdict", () => {
    const validated = validateResumeEvidence(
      evidence([
        { label: "Kubernetes", level: "not_present", quotes: ["Built APIs using TypeScript."] },
      ]),
      criteria(["Kubernetes", "must_have"]),
      RESUME,
    );

    expect(validated.criteria[0].evidence_level).toBe("not_present");
    expect(validated.criteria[0].evidence_items).toEqual([]);
    expect(validated.warnings[0]).toContain("not_present");
  });

  it("never lets an unverified quote earn credit for a must-have", () => {
    const validated = validateResumeEvidence(
      evidence([
        { label: "Kubernetes", level: "strong", quotes: ["Owned the Kubernetes migration."] },
      ]),
      criteria(["Kubernetes", "must_have"]),
      RESUME,
    );

    // "unclear" scores 0, so the downgrade is what stops a fabricated quote
    // from opening a gate.
    expect(validated.criteria[0].evidence_level).toBe("unclear");
  });
});
