import { describe, it, expect } from "vitest";
import { buildInterviewAdvanceEmail } from "./interview-advance";

describe("buildInterviewAdvanceEmail", () => {
  const base = {
    candidateName: "Jane Doe",
    campaignTitle: "Senior Engineer",
  };

  it("greets the candidate by first name and names the role", () => {
    const email = buildInterviewAdvanceEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.subject).toContain("Senior Engineer");
  });

  it("tells the candidate details will follow — it carries no action link yet", () => {
    const email = buildInterviewAdvanceEmail(base);
    expect(email.text).toContain("follow up shortly");
    expect(email.text).not.toContain("http");
    expect(email.html).not.toContain("href=");
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildInterviewAdvanceEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });

  it("escapes HTML in the campaign title", () => {
    const email = buildInterviewAdvanceEmail({
      ...base,
      campaignTitle: "Dev <script>",
    });
    expect(email.html).toContain("Dev &lt;script&gt;");
    expect(email.html).not.toContain("Dev <script>");
  });
});
