import { describe, it, expect } from "vitest";
import { buildInterviewReminderEmail } from "./interview-reminder";

describe("buildInterviewReminderEmail", () => {
  const base = {
    candidateName: "Jane Doe",
    campaignTitle: "Senior Engineer",
    interviewAt: new Date("2026-06-02T18:30:00Z"),
  };

  it("greets the candidate and includes the interview date", () => {
    const email = buildInterviewReminderEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.text).toMatch(/2026/);
  });

  it("reads as a reminder", () => {
    const email = buildInterviewReminderEmail(base);
    expect(email.subject.toLowerCase()).toContain("reminder");
  });

  it("renders the join button only when a url is supplied", () => {
    const withJoin = buildInterviewReminderEmail({
      ...base,
      joinUrl: "https://x.test/join",
    });
    const withoutJoin = buildInterviewReminderEmail(base);
    expect(withJoin.html).toContain("https://x.test/join");
    expect(withoutJoin.html).not.toContain("Join the interview");
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildInterviewReminderEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });
});
