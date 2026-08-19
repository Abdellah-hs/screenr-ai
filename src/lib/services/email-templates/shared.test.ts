import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  firstNameOf,
  formatDateTime,
  renderButton,
  renderEmailLayout,
} from "./shared";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Jane Doe")).toBe("Jane Doe");
  });
});

describe("firstNameOf", () => {
  it("returns the first whitespace-delimited token", () => {
    expect(firstNameOf("Jane Aretha Doe")).toBe("Jane");
  });

  it("falls back to the whole string when there is no space", () => {
    expect(firstNameOf("Cher")).toBe("Cher");
  });
});

describe("formatDateTime", () => {
  it("renders a human-readable date that includes the year", () => {
    expect(formatDateTime(new Date("2026-06-02T18:30:00Z"))).toMatch(/2026/);
  });

  /**
   * Without a zone this renders in the server's timezone — UTC on Vercel — so
   * an interview email would quote a candidate an hour they never agreed to.
   */
  it("renders the time in the zone it is given", () => {
    const at = new Date("2026-06-02T18:30:00Z");

    expect(formatDateTime(at, "Asia/Tokyo")).toContain("3:30 AM");
    expect(formatDateTime(at, "Asia/Tokyo")).toContain("June 3");
  });

  it("falls back to the server default rather than throwing on an unknown zone", () => {
    const at = new Date("2026-06-02T18:30:00Z");

    expect(formatDateTime(at, "Mars/Olympus_Mons")).toBe(formatDateTime(at));
  });

  it("falls back when no zone is known", () => {
    const at = new Date("2026-06-02T18:30:00Z");

    expect(formatDateTime(at, null)).toBe(formatDateTime(at));
  });
});

describe("renderEmailLayout", () => {
  it("embeds the inner HTML inside the card shell", () => {
    const html = renderEmailLayout("<p>hello world</p>");
    expect(html).toContain("<p>hello world</p>");
    expect(html).toContain("<!DOCTYPE html>");
  });
});

describe("renderButton", () => {
  it("escapes the url and renders the label", () => {
    const html = renderButton("https://x.test/a?b=1&c=2", "Go");
    expect(html).toContain("https://x.test/a?b=1&amp;c=2");
    expect(html).toContain(">Go</a>");
  });
});
