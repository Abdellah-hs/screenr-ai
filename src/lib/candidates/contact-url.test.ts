import { describe, expect, it } from "vitest";

import { toExternalUrl } from "@/lib/candidates/contact-url";

describe("toExternalUrl", () => {
  it("leaves a link that already spells out its scheme alone", () => {
    expect(toExternalUrl("https://github.com/alice")).toBe("https://github.com/alice");
    expect(toExternalUrl("http://alice.dev/work")).toBe("http://alice.dev/work");
  });

  it("restores the scheme a CV printed its links without", () => {
    expect(toExternalUrl("github.com/alice")).toBe("https://github.com/alice");
    expect(toExternalUrl("www.linkedin.com/in/alice-ng")).toBe(
      "https://www.linkedin.com/in/alice-ng",
    );
  });

  it("completes a protocol-relative URL", () => {
    expect(toExternalUrl("//github.com/alice")).toBe("https://github.com/alice");
  });

  it("trims surrounding whitespace", () => {
    expect(toExternalUrl("  github.com/alice  ")).toBe("https://github.com/alice");
  });

  it("refuses a bare handle rather than guessing which site it belongs to", () => {
    expect(toExternalUrl("alice")).toBeNull();
    expect(toExternalUrl("in/alice-ng")).toBeNull();
    expect(toExternalUrl("@alice")).toBeNull();
  });

  it("refuses a scheme an href would execute", () => {
    expect(toExternalUrl("javascript:alert(1)")).toBeNull();
    expect(toExternalUrl("JavaScript:alert(1)")).toBeNull();
    expect(toExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses a scheme that is not a web link", () => {
    expect(toExternalUrl("mailto:alice@example.com")).toBeNull();
    expect(toExternalUrl("ftp://files.example.com/cv.pdf")).toBeNull();
  });

  it("refuses prose that merely mentions a profile", () => {
    expect(toExternalUrl("See my GitHub")).toBeNull();
    expect(toExternalUrl("Available on request")).toBeNull();
  });

  it("treats absence as absence", () => {
    expect(toExternalUrl(null)).toBeNull();
    expect(toExternalUrl(undefined)).toBeNull();
    expect(toExternalUrl("   ")).toBeNull();
  });
});
