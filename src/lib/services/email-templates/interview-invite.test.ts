import { describe, expect, it } from "vitest";
import { INTERVIEW_DURATION_MINUTES } from "@/lib/constants";
import { buildInterviewInviteEmail } from "./interview-invite";

const base = {
  candidateName: "Ada Lovelace",
  campaignTitle: "Staff Engineer",
  interviewUrl: "https://app.example.com/interview/tok",
};

const PREP_URL = "https://app.example.com/prep/tok";

describe("buildInterviewInviteEmail", () => {
  it("addresses the candidate by first name and names the role", () => {
    const email = buildInterviewInviteEmail(base);

    expect(email.text).toContain("Hi Ada,");
    expect(email.subject).toContain("Staff Engineer");
  });

  it("carries the interview link in both bodies", () => {
    const email = buildInterviewInviteEmail(base);

    expect(email.text).toContain(base.interviewUrl);
    expect(email.html).toContain(base.interviewUrl);
  });

  it("sets expectations the client actually enforces", () => {
    // Desktop-only and camera-required are hard requirements at the door; an
    // email that omits them sends people to a page that refuses to start.
    const email = buildInterviewInviteEmail(base);

    expect(email.text).toContain("desktop or laptop");
    expect(email.text).toContain("camera");
    expect(email.text).toContain(String(INTERVIEW_DURATION_MINUTES));
  });

  it("mentions the deadline only when one is supplied", () => {
    const withDeadline = buildInterviewInviteEmail({
      ...base,
      expiresAt: "2026-09-01T09:00:00.000Z",
    });

    expect(withDeadline.text).toContain("September 1, 2026");
    expect(buildInterviewInviteEmail(base).text).not.toContain("complete it by");
  });

  it("escapes candidate-supplied text in the HTML body", () => {
    const email = buildInterviewInviteEmail({
      ...base,
      candidateName: "<script>alert(1)</script>",
    });

    expect(email.html).not.toContain("<script>");
  });
});

describe("buildInterviewInviteEmail — prep guide link (I23)", () => {
  it("links the prep guide in both the text and HTML bodies", () => {
    const email = buildInterviewInviteEmail({ ...base, prepGuideUrl: PREP_URL });

    expect(email.text).toContain(PREP_URL);
    expect(email.html).toContain(PREP_URL);
  });

  /**
   * The guide is a nicety; the interview link is the point. A missing origin
   * must not produce an email with a dangling "read the prep guide" that goes
   * nowhere.
   */
  it("omits the prep paragraph entirely when no URL is supplied", () => {
    const email = buildInterviewInviteEmail(base);

    expect(email.text).not.toContain("prep guide");
    expect(email.html).not.toContain("prep guide");
    expect(email.text).toContain(base.interviewUrl);
  });

  it("still leads with the interview link, not the guide", () => {
    const email = buildInterviewInviteEmail({ ...base, prepGuideUrl: PREP_URL });

    expect(email.text.indexOf(base.interviewUrl)).toBeLessThan(
      email.text.indexOf(PREP_URL),
    );
  });
});
