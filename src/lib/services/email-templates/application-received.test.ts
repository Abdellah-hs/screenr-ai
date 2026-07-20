import { describe, it, expect } from "vitest";
import { buildApplicationReceivedEmail } from "./application-received";

describe("buildApplicationReceivedEmail", () => {
  const params = {
    candidateName: "Alice Smith",
    campaignTitle: "Backend Engineer",
    companyName: "Matious",
  };

  it("puts the campaign title in the subject", () => {
    const { subject } = buildApplicationReceivedEmail(params);

    expect(subject).toContain("Backend Engineer");
    expect(subject).toMatch(/received your application/i);
  });

  it("greets the candidate by first name in both bodies", () => {
    const { text, html } = buildApplicationReceivedEmail(params);

    expect(text).toContain("Hi Alice,");
    expect(html).toContain("Hi Alice,");
  });

  it("signs off with the company name", () => {
    const { text, html } = buildApplicationReceivedEmail(params);

    expect(text).toContain("Matious");
    expect(html).toContain("Matious");
  });

  it("defaults the signature to the hiring team when no company is given", () => {
    const { text } = buildApplicationReceivedEmail({
      candidateName: "Alice Smith",
      campaignTitle: "Backend Engineer",
    });

    expect(text).toContain("the hiring team");
  });

  it("escapes HTML in the campaign title", () => {
    const { html } = buildApplicationReceivedEmail({
      ...params,
      campaignTitle: 'QA <script>alert("x")</script> Engineer',
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never mentions scores or screening outcomes", () => {
    const { text, html } = buildApplicationReceivedEmail(params);

    expect(text.toLowerCase()).not.toMatch(/score|rank|shortlist/);
    expect(html.toLowerCase()).not.toMatch(/score|rank|shortlist/);
  });
});
