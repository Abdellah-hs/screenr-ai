import { describe, it, expect } from "vitest";
import { buildInterviewRescheduleNeededEmail } from "./interview-reschedule-needed";

describe("buildInterviewRescheduleNeededEmail", () => {
  const base = {
    candidateName: "Jane Doe",
    campaignTitle: "Senior Engineer",
    scheduleUrl: "https://hire.example.com/schedule/abc.def",
  };

  it("greets the candidate by first name and names the role", () => {
    const email = buildInterviewRescheduleNeededEmail(base);
    expect(email.text).toContain("Hi Jane,");
    expect(email.subject).toContain("Senior Engineer");
  });

  it("makes clear the existing time changed and a new pick is needed", () => {
    const email = buildInterviewRescheduleNeededEmail(base);
    expect(email.subject.toLowerCase()).toContain("new time");
    expect(email.text.toLowerCase()).toContain("no longer available");
  });

  it("includes the same scheduling link in both text and HTML bodies", () => {
    const email = buildInterviewRescheduleNeededEmail(base);
    expect(email.text).toContain("https://hire.example.com/schedule/abc.def");
    expect(email.html).toContain('href="https://hire.example.com/schedule/abc.def"');
  });

  it("never leaks an undefined into the rendered output", () => {
    const email = buildInterviewRescheduleNeededEmail(base);
    expect(email.subject + email.text + email.html).not.toContain("undefined");
  });

  it("escapes HTML in the campaign title", () => {
    const email = buildInterviewRescheduleNeededEmail({
      ...base,
      campaignTitle: "Dev <script>",
    });
    expect(email.html).toContain("Dev &lt;script&gt;");
    expect(email.html).not.toContain("Dev <script>");
  });
});
