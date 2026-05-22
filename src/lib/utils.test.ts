import { describe, expect, it } from "vitest";

import { initialsFromEmail } from "./utils";

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
