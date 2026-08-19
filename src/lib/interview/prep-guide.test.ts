import { describe, expect, it } from "vitest";
import { INTERVIEW_PERSONAS, type InterviewPersona } from "@/lib/constants";
import { buildPrepGuide, personaExpectation } from "./prep-guide";

const ALL_PERSONAS = INTERVIEW_PERSONAS.map((p) => p.value);

function guideText(persona: InterviewPersona = "neutral"): string {
  return buildPrepGuide({ roleTitle: "Staff Engineer", persona })
    .sections.flatMap((s) => [s.title, ...s.items])
    .join(" ");
}

describe("personaExpectation", () => {
  it("has copy for every persona the campaign form offers", () => {
    // A missing one would render `undefined` to a candidate.
    for (const persona of ALL_PERSONAS) {
      expect(personaExpectation(persona).length).toBeGreaterThan(0);
    }
  });

  /**
   * The agent's own directives are tactics — "when an answer sounds
   * comfortable or well-rehearsed, push back on it directly". Repeating those
   * to the candidate is a manual for defeating the probe, and the probe is the
   * point of an unscripted follow-up.
   */
  it("never repeats the interviewer's tactics back to the candidate", () => {
    const leaks = [
      "push back",
      "rehearsed",
      "interrogat",
      "do not explain",
      "never tell them",
      "runs out",
    ];

    for (const persona of ALL_PERSONAS) {
      const copy = personaExpectation(persona).toLowerCase();
      for (const leak of leaks) {
        expect(copy).not.toContain(leak);
      }
    }
  });

  /**
   * Saying nothing is the other bad option: a candidate pressed hard with no
   * warning reads it as hostility and performs worse for reasons unrelated to
   * their ability, which makes the score less informative.
   */
  it("warns that a pressure interview is the format, not a bad sign", () => {
    const copy = personaExpectation("pressure").toLowerCase();

    expect(copy).toContain("challenged");
    expect(copy).toContain("not a signal");
  });

  it("reassures that a socratic interviewer withholding confirmation is deliberate", () => {
    expect(personaExpectation("socratic").toLowerCase()).toContain("by design");
  });
});

describe("buildPrepGuide", () => {
  it("names the role the candidate applied for", () => {
    expect(guideText()).toContain("Staff Engineer");
  });

  it("uses the persona copy for the campaign's configured stance", () => {
    expect(guideText("pressure")).toContain(personaExpectation("pressure"));
    expect(guideText("pressure")).not.toContain(personaExpectation("socratic"));
  });

  it("defaults to the configured interview duration", () => {
    const guide = buildPrepGuide({ roleTitle: "Staff Engineer", persona: "neutral" });

    expect(guide.durationMinutes).toBeGreaterThan(0);
    expect(guideText()).toContain(String(guide.durationMinutes));
  });

  it("honours an overridden duration everywhere it appears", () => {
    // Guards the shape #136 will need when duration becomes configurable.
    const guide = buildPrepGuide({
      roleTitle: "Staff Engineer",
      persona: "neutral",
      durationMinutes: 45,
    });
    const text = guide.sections.flatMap((s) => s.items).join(" ");

    expect(guide.durationMinutes).toBe(45);
    expect(text).toContain("45 minutes");
    expect(text).not.toContain("10 minutes");
  });

  /**
   * The interview is desktop-only and the candidate is most likely reading
   * this on their phone, straight from the invitation email. If the guide
   * fails to say so, they find out when the interview refuses to start.
   */
  it("tells the candidate the interview will not run on a phone", () => {
    const text = guideText().toLowerCase();

    expect(text).toContain("desktop or laptop");
    expect(text).toContain("phone");
  });

  /**
   * The 2026-08-04 decision not to record, stated to the person it most
   * affects — and the transcript that IS kept, stated alongside it, because a
   * half-told privacy posture is worse than none.
   */
  it("states plainly that the video is not recorded but the transcript is kept", () => {
    const text = guideText().toLowerCase();

    expect(text).toContain("not recorded");
    expect(text).toContain("transcript");
  });

  it("discloses that the interview is monitored for integrity", () => {
    expect(guideText().toLowerCase()).toContain("monitored for integrity");
  });

  it("returns non-empty sections, each with a title and items", () => {
    const guide = buildPrepGuide({ roleTitle: "Staff Engineer", persona: "neutral" });

    expect(guide.sections.length).toBeGreaterThan(0);
    for (const section of guide.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
    }
  });
});
