import { describe, it, expect } from "vitest";
import { buildAdvanceScreeningEmail } from "./advance-screening";

describe("buildAdvanceScreeningEmail", () => {
  const base = { candidateName: "Jane Doe", campaignTitle: "Senior Engineer" };

  it("greets the candidate by first name and names the role", () => {
    const email = buildAdvanceScreeningEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.subject).toContain("Senior Engineer");
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildAdvanceScreeningEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });

  it("escapes HTML in the campaign title", () => {
    const email = buildAdvanceScreeningEmail({
      ...base,
      campaignTitle: "Dev <script>",
    });
    expect(email.html).toContain("Dev &lt;script&gt;");
    expect(email.html).not.toContain("Dev <script>");
  });
});
