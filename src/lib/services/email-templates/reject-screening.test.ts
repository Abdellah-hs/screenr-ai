import { describe, it, expect } from "vitest";
import { buildRejectScreeningEmail } from "./reject-screening";

describe("buildRejectScreeningEmail", () => {
  const base = { candidateName: "Jane Doe", campaignTitle: "Senior Engineer" };

  it("greets the candidate by first name and names the role", () => {
    const email = buildRejectScreeningEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.subject).toContain("Senior Engineer");
  });

  it("reads as a respectful close-out", () => {
    const email = buildRejectScreeningEmail(base);
    expect(email.text).toContain("not to move forward");
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildRejectScreeningEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });

  it("escapes HTML in the campaign title", () => {
    const email = buildRejectScreeningEmail({
      ...base,
      campaignTitle: "Dev <script>",
    });
    expect(email.html).toContain("Dev &lt;script&gt;");
    expect(email.html).not.toContain("Dev <script>");
  });
});
