import { describe, it, expect } from "vitest";
import { buildApplicationProblemEmail } from "./application-problem";

describe("buildApplicationProblemEmail", () => {
  const base = {
    candidateName: "Jane Doe",
    campaignTitle: "Senior Engineer",
    reasonMessage: "That file doesn't look like a CV or resume.",
    applyUrl: "https://hire.example.com/apply/senior-engineer",
  };

  it("greets the candidate, names the role, and flags action needed", () => {
    const email = buildApplicationProblemEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.subject).toContain("Senior Engineer");
    expect(email.subject.toLowerCase()).toContain("action needed");
  });

  it("carries the actionable reason and the apply-again link in both bodies", () => {
    const email = buildApplicationProblemEmail(base);
    expect(email.text).toContain("That file doesn't look like a CV or resume.");
    expect(email.text).toContain("https://hire.example.com/apply/senior-engineer");
    expect(email.html).toContain("doesn&#39;t look like a CV");
    expect(email.html).toContain('href="https://hire.example.com/apply/senior-engineer"');
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildApplicationProblemEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });

  it("escapes HTML in the campaign title and reason", () => {
    const email = buildApplicationProblemEmail({
      ...base,
      campaignTitle: "Dev <script>",
      reasonMessage: "Bad <b>file</b>",
    });
    expect(email.html).toContain("Dev &lt;script&gt;");
    expect(email.html).toContain("Bad &lt;b&gt;file&lt;/b&gt;");
  });
});
