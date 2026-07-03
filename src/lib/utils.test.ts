import { describe, expect, it } from "vitest";

import { initialsFromEmail, slugifyTitle } from "./utils";

describe("initialsFromEmail", () => {
  it("combines the first letter of each segment when the local part is dotted", () => {
    const result = initialsFromEmail("jane.doe@example.com");

    expect(result).toBe("JD");
  });

  it("uses the first two letters when the local part is a single word", () => {
    const result = initialsFromEmail("it@matious.com");

    expect(result).toBe("IT");
  });

  it("treats underscores and hyphens as segment separators", () => {
    const result = initialsFromEmail("john_paul-smith@example.com");

    expect(result).toBe("JP");
  });

  it("uppercases initials taken from a lowercase address", () => {
    const result = initialsFromEmail("ada@example.com");

    expect(result).toBe("AD");
  });

  it("returns a single letter when the local part is one character", () => {
    const result = initialsFromEmail("x@example.com");

    expect(result).toBe("X");
  });

  it("returns a placeholder when the email has no local part", () => {
    const result = initialsFromEmail("");

    expect(result).toBe("?");
  });
});

describe("slugifyTitle", () => {
  it("lowercases and hyphenates a normal title", () => {
    expect(slugifyTitle("Senior Frontend Engineer")).toBe("senior-frontend-engineer");
  });

  it("collapses runs of punctuation and whitespace into a single hyphen", () => {
    expect(slugifyTitle("Data   Scientist (ML/AI) — 2026!")).toBe("data-scientist-ml-ai-2026");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyTitle("  --Backend Dev--  ")).toBe("backend-dev");
  });

  it("strips accents/diacritics down to ascii", () => {
    expect(slugifyTitle("Développeur Sénior")).toBe("developpeur-senior");
  });

  it("falls back to 'campaign' when nothing slug-able remains", () => {
    expect(slugifyTitle("!!!")).toBe("campaign");
    expect(slugifyTitle("")).toBe("campaign");
  });

  it("caps the slug length without leaving a trailing hyphen", () => {
    const result = slugifyTitle("a".repeat(100));

    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith("-")).toBe(false);
  });
});
