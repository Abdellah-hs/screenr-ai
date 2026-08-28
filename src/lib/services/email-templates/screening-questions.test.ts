import { describe, it, expect } from "vitest";
import { buildScreeningQuestionsEmail } from "./screening-questions";
import { screeningCallEstimateMinutes } from "@/lib/constants";

function email(over: Partial<Parameters<typeof buildScreeningQuestionsEmail>[0]> = {}) {
  return buildScreeningQuestionsEmail({
    candidateName: "Ada Lovelace",
    campaignTitle: "Senior Backend Engineer",
    companyName: "Acme",
    respondUrl: "https://screenr.example/respond/tok_abc",
    expiresAt: new Date("2026-09-01T00:00:00Z"),
    questionCount: 5,
    ...over,
  });
}

describe("buildScreeningQuestionsEmail", () => {
  it("greets the candidate by first name and names the role", () => {
    const { text, html } = email();

    expect(text).toContain("Hi Ada,");
    expect(html).toContain("Senior Backend Engineer");
  });

  it("carries the link and the deadline", () => {
    const { text, html } = email();

    expect(text).toContain("https://screenr.example/respond/tok_abc");
    expect(html).toContain("https://screenr.example/respond/tok_abc");
    expect(text).toContain("September 1, 2026");
  });

  /**
   * The copy was written for the typed form that #161 deleted: it promised
   * "15–25 minutes to complete them" and a button reading "Answer the
   * questions", so a candidate budgeted twenty minutes of typing and landed on
   * a live call needing a microphone.
   */
  it("describes a spoken interview, not a form to fill in", () => {
    const { text, html, subject } = email();

    expect(subject).toMatch(/spoken interview/i);
    expect(text).toMatch(/spoken interview/i);
    expect(text).toMatch(/quiet spot and a working microphone/i);
    expect(html).toContain("Start the interview");
    expect(text).not.toMatch(/15–25 minutes/);
  });

  /**
   * The number the candidate plans their day around has to match the one on
   * the pre-call screen. Both are ESTIMATES since 2026-08-24 — the call is
   * paced per answer and nothing is enforced against this figure — but a
   * candidate who was told seven minutes by email and five by the page has
   * been told the product does not know.
   */
  it("quotes the same estimate the pre-call screen shows", () => {
    for (const questionCount of [3, 5, 8]) {
      const { text, html } = email({ questionCount });
      const minutes = screeningCallEstimateMinutes(questionCount);

      expect(text).toContain(`about ${minutes} minutes`);
      expect(html).toContain(`<strong>${minutes} minutes</strong>`);
    }
  });

  it("states how many topics the call covers", () => {
    const { text } = email({ questionCount: 7 });

    expect(text).toContain("7 topics");
  });

  /**
   * Three promises the candidate is most anxious about, and the apply page
   * makes the same ones. Saying them here is what lets someone decide when to
   * sit down for this rather than clicking to find out.
   */
  it("promises no recording, and a restart only while the call is still theirs", () => {
    const { text, html } = email();

    expect(text).toMatch(/Nothing is recorded/);
    expect(html).toMatch(/Nothing is recorded/);

    // It used to promise a re-record "before you submit". Since the
    // interviewer signs off and the answers submit themselves, there is no
    // moment after the goodbye in which that offer is true — and a candidate
    // who counted on it would find the call already gone.
    expect(text).not.toMatch(/re-record before you submit/);
    expect(text).toMatch(/while the call is still yours/);
  });

  it("escapes html-unsafe values rather than injecting them into the markup", () => {
    const { html } = email({ campaignTitle: 'Dev <script>alert("x")</script>' });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to a neutral sender when no company name is given", () => {
    const { text } = email({ companyName: undefined });

    expect(text).toContain("the hiring team");
  });
});
