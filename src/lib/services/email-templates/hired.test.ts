import { describe, it, expect } from "vitest";
import { buildHiredEmail } from "./hired";

describe("buildHiredEmail", () => {
  const base = {
    candidateName: "Jane Doe",
    campaignTitle: "Senior Engineer",
  };

  it("congratulates the candidate by first name and names the role", () => {
    const email = buildHiredEmail(base);

    expect(email.text).toContain("Hi Jane,");
    expect(email.text).toContain("Congratulations");
    expect(email.subject).toContain("Senior Engineer");
  });

  it("promises the formal offer as a follow-up rather than stating terms", () => {
    const email = buildHiredEmail(base);

    expect(email.text).toContain("formal offer");
    expect(email.text).not.toContain("http");
    expect(email.html).not.toContain("href=");
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildHiredEmail(base);

    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });

  it("escapes HTML in the campaign title", () => {
    const email = buildHiredEmail({ ...base, campaignTitle: "Dev <script>" });

    expect(email.html).toContain("Dev &lt;script&gt;");
    expect(email.html).not.toContain("Dev <script>");
  });

  it("signs off with the supplied company name", () => {
    const email = buildHiredEmail({ ...base, companyName: "MatiousCorp" });

    expect(email.text).toContain("MatiousCorp");
    expect(email.html).toContain("MatiousCorp");
  });
});
