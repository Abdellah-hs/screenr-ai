import { describe, it, expect } from "vitest";
import {
  buildNormalizedResumeDocument,
  buildResumeDocument,
  normalizeResumeDocument,
} from "./document";
import { normalizedIncludes } from "./validate";

const PARSED = {
  first_name: "Ada",
  last_name: "Lovelace",
  headline: "Senior Platform Engineer",
  summary: "Ten years building developer tooling.",
  skills: ["TypeScript", "PostgreSQL"],
  languages: ["English", "French"],
  certifications: ["AWS Solutions Architect"],
  interests: ["Chess"],
  experience: [
    {
      company: "Acme",
      title: "Senior Engineer",
      duration: "2019-2024",
      description: "Built APIs using TypeScript.",
    },
  ],
  education: [
    { institution: "MIT", degree: "BSc Computer Science", year_start: "2011", year_end: "2015" },
  ],
};

describe("buildResumeDocument", () => {
  it("includes every section the parser filled in", () => {
    const doc = buildResumeDocument({ parsed: PARSED });

    expect(doc).toContain("Ada Lovelace");
    expect(doc).toContain("Senior Platform Engineer");
    expect(doc).toContain("TypeScript, PostgreSQL");
    expect(doc).toContain("Built APIs using TypeScript.");
    expect(doc).toContain("BSc Computer Science, MIT");
    expect(doc).toContain("AWS Solutions Architect");
  });

  it("omits sections the parser left empty rather than printing blank headings", () => {
    const doc = buildResumeDocument({ parsed: { first_name: "Ada", last_name: "Lovelace" } });

    expect(doc).toContain("Ada Lovelace");
    expect(doc).not.toContain("## Skills");
    expect(doc).not.toContain("## Experience");
  });

  it("appends the original text when the caller still has it", () => {
    const doc = buildResumeDocument({ parsed: PARSED, rawText: "Owned the payments migration." });

    expect(doc).toContain("## Original resume text");
    expect(doc).toContain("Owned the payments migration.");
  });

  it("survives a malformed parsed_data blob without throwing", () => {
    const doc = buildResumeDocument({
      parsed: { first_name: "Ada", skills: "TypeScript", experience: [null, 42] },
      rawText: "Fallback text.",
    });

    expect(doc).toContain("Ada");
    expect(doc).toContain("Fallback text.");
  });

  it("returns an empty document for empty input, so the caller can reject it", () => {
    expect(buildResumeDocument({ parsed: null })).toBe("");
  });
});

describe("normalizeResumeDocument", () => {
  it("throws on a document with nothing in it", () => {
    expect(() => normalizeResumeDocument("   \n\n  ")).toThrow(/empty/i);
  });

  it("collapses runs of spaces and blank lines", () => {
    expect(normalizeResumeDocument("a    b\n\n\n\nc")).toBe("a b\n\nc");
  });

  it("truncates an over-long document and says so in the text", () => {
    const long = `HEAD${"x".repeat(80_000)}TAIL`;
    const normalized = normalizeResumeDocument(long);

    expect(normalized.length).toBeLessThan(long.length);
    expect(normalized).toContain("truncated");
    expect(normalized.startsWith("HEAD")).toBe(true);
    expect(normalized.endsWith("TAIL")).toBe(true);
  });
});

describe("buildNormalizedResumeDocument", () => {
  it("produces a document that quote verification can actually match against", () => {
    const doc = buildNormalizedResumeDocument({ parsed: PARSED });

    // The contract the whole design rests on: a phrase in the parsed resume is
    // findable in the exact string the model was shown.
    expect(normalizedIncludes(doc, "Built APIs using TypeScript.")).toBe(true);
    expect(normalizedIncludes(doc, "Ran a Kubernetes fleet.")).toBe(false);
  });

  it("is deterministic for the same input", () => {
    expect(buildNormalizedResumeDocument({ parsed: PARSED })).toBe(
      buildNormalizedResumeDocument({ parsed: PARSED }),
    );
  });
});
