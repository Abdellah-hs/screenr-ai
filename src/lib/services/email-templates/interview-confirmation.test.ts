import { describe, it, expect } from "vitest";
import { buildInterviewConfirmationEmail } from "./interview-confirmation";

describe("buildInterviewConfirmationEmail", () => {
  const base = {
    candidateName: "Jane Doe",
    campaignTitle: "Senior Engineer",
    interviewAt: new Date("2026-06-02T18:30:00Z"),
  };

  it("greets the candidate and includes the interview date", () => {
    const email = buildInterviewConfirmationEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.text).toMatch(/2026/);
  });

  it("renders the prep-guide button only when a url is supplied", () => {
    const withGuide = buildInterviewConfirmationEmail({
      ...base,
      prepGuideUrl: "https://x.test/prep",
    });
    const withoutGuide = buildInterviewConfirmationEmail(base);
    expect(withGuide.html).toContain("https://x.test/prep");
    expect(withoutGuide.html).not.toContain("Read the prep guide");
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildInterviewConfirmationEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });
});
