import { describe, expect, it } from "vitest";
import { normalizeForQuoteMatch, normalizedIncludes } from "./quotes";

/**
 * The single quote matcher all three scored stages verify against.
 *
 * It has one job in each direction, and both directions cost something real.
 * Too strict and a candidate loses credit for words they genuinely said,
 * because a model re-typed a curly apostrophe as a straight one. Too loose and
 * credit is awarded for a quote nobody can find — the one thing CLAUDE.md says
 * must never happen at any stage.
 */

const RESUME = [
  "## Experience",
  "Senior Engineer at Acme (2019–2024)",
  "Built  APIs   using “TypeScript” and ran the on‑call rotation.",
].join("\n");

describe("normalizeForQuoteMatch", () => {
  it("collapses runs of whitespace, including the line breaks we insert", () => {
    expect(normalizeForQuoteMatch("Built  APIs\nusing TypeScript.")).toBe(
      "built apis using typescript.",
    );
  });

  it("folds curly quotes onto straight ones", () => {
    expect(normalizeForQuoteMatch("“TypeScript”")).toBe('"typescript"');
    expect(normalizeForQuoteMatch("it’s")).toBe("it's");
  });

  it("folds every dash variant onto a hyphen", () => {
    expect(normalizeForQuoteMatch("2019–2024")).toBe("2019-2024");
    expect(normalizeForQuoteMatch("on‑call")).toBe("on-call");
  });

  it("expands an ellipsis character to three dots", () => {
    expect(normalizeForQuoteMatch("and so on…")).toBe("and so on...");
  });

  it("strips zero-width characters that survive a copy-paste", () => {
    expect(normalizeForQuoteMatch("Type​Script")).toBe("typescript");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeForQuoteMatch("  Kubernetes  ")).toBe("kubernetes");
  });

  /**
   * The limit that keeps this honest. Folding is only allowed to erase
   * differences that are not differences in what was SAID — so words, digits
   * and ordinary punctuation all survive, and two genuinely different sentences
   * can never be normalised into each other.
   */
  it("does not fold two different words together", () => {
    expect(normalizeForQuoteMatch("TypeScript")).not.toBe(normalizeForQuoteMatch("JavaScript"));
    expect(normalizeForQuoteMatch("18 months")).not.toBe(normalizeForQuoteMatch("8 months"));
    expect(normalizeForQuoteMatch("led the team")).not.toBe(
      normalizeForQuoteMatch("joined the team"),
    );
  });
});

describe("normalizedIncludes", () => {
  it("finds a quote that differs only in spacing and case", () => {
    expect(normalizedIncludes(RESUME, "built   apis USING “TypeScript”")).toBe(true);
  });

  it("finds a quote the source wrapped across a line break", () => {
    expect(
      normalizedIncludes("Built APIs\nusing TypeScript.", "Built APIs using TypeScript."),
    ).toBe(true);
  });

  it("finds a quote whose dashes were retyped", () => {
    expect(normalizedIncludes(RESUME, "Acme (2019-2024)")).toBe(true);
  });

  /** The rule: no verified quote, no credit. */
  it("rejects a quote that is not in the source", () => {
    expect(normalizedIncludes(RESUME, "Architected a Kubernetes platform.")).toBe(false);
  });

  it("rejects a quote that only overlaps the source in part", () => {
    expect(normalizedIncludes(RESUME, "Built APIs using Rust")).toBe(false);
  });

  /**
   * An empty needle is inside every string. Returning true would award full
   * credit for supplying no evidence at all — the cheapest possible way past
   * verification, and the one a model is most likely to stumble into.
   */
  it("rejects an empty quote", () => {
    expect(normalizedIncludes(RESUME, "")).toBe(false);
  });

  it("rejects a whitespace-only quote", () => {
    expect(normalizedIncludes(RESUME, "   \n\t ")).toBe(false);
  });

  it("finds nothing in an empty source", () => {
    expect(normalizedIncludes("", "TypeScript")).toBe(false);
  });
});
