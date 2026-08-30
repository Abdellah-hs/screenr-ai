import { describe, expect, it } from "vitest";
import {
  buildCandidateSpeech,
  buildTranscriptDocument,
  hasCandidateSpeech,
  type TranscriptTurn,
} from "./transcript";

/**
 * The rendering both spoken stages grade from. One property here is a rule
 * rather than a formatting choice, and it is the reason this file is worth
 * having on its own: verification runs against the candidate's half of the
 * transcript, never the whole of it.
 */

const TRANSCRIPT: TranscriptTurn[] = [
  {
    role: "agent",
    text: "Tell me about a time you scaled a system past its first design.",
    at: "2026-08-28T10:00:00.000Z",
  },
  {
    role: "candidate",
    text: "We moved billing off a single Postgres box to read replicas.",
    at: "2026-08-28T10:00:20.000Z",
  },
  {
    role: "agent",
    text: "What broke first?",
    at: "2026-08-28T10:01:00.000Z",
  },
  {
    role: "candidate",
    text: "Month-end reporting queries, which we had never load tested.",
    at: "2026-08-28T10:01:10.000Z",
  },
];

describe("buildTranscriptDocument", () => {
  it("labels each turn with the speaker the model is shown", () => {
    expect(buildTranscriptDocument(TRANSCRIPT.slice(0, 2))).toBe(
      "Interviewer: Tell me about a time you scaled a system past its first design.\n" +
        "Candidate: We moved billing off a single Postgres box to read replicas.",
    );
  });

  it("keeps the turns in conversation order", () => {
    const doc = buildTranscriptDocument(TRANSCRIPT);

    expect(doc.indexOf("What broke first?")).toBeGreaterThan(doc.indexOf("read replicas."));
  });

  it("renders an empty transcript as an empty document", () => {
    expect(buildTranscriptDocument([])).toBe("");
  });
});

describe("buildCandidateSpeech", () => {
  /**
   * The rule. The interviewer states the topic of every question, so a quote
   * lifted from its turn would verify cleanly against the full document and
   * award credit for the subject merely having been RAISED — a rubric
   * dimension scored on the question rather than on any answer to it.
   */
  it("excludes the interviewer's turns entirely", () => {
    const speech = buildCandidateSpeech(TRANSCRIPT);

    expect(speech).not.toContain("scaled a system past its first design");
    expect(speech).not.toContain("What broke first?");
  });

  it("keeps every candidate turn", () => {
    const speech = buildCandidateSpeech(TRANSCRIPT);

    expect(speech).toContain("We moved billing off a single Postgres box");
    expect(speech).toContain("Month-end reporting queries");
  });

  it("is empty when only the interviewer spoke", () => {
    expect(buildCandidateSpeech(TRANSCRIPT.filter((t) => t.role === "agent"))).toBe("");
  });
});

describe("hasCandidateSpeech", () => {
  /**
   * The short-circuit this gates matters: a transcript with no candidate speech
   * is scored `not_present` across the board in code, WITHOUT calling the
   * model, because a model handed silence invents answers to fill it.
   */
  it("is false when the candidate never spoke", () => {
    expect(hasCandidateSpeech(TRANSCRIPT.filter((t) => t.role === "agent"))).toBe(false);
  });

  it("is false for an empty transcript", () => {
    expect(hasCandidateSpeech([])).toBe(false);
  });

  it("is false when the candidate's only turn is whitespace", () => {
    expect(
      hasCandidateSpeech([
        { role: "agent", text: "Are you there?", at: "2026-08-28T10:00:00.000Z" },
        { role: "candidate", text: "   \n  ", at: "2026-08-28T10:00:05.000Z" },
      ]),
    ).toBe(false);
  });

  it("is true as soon as the candidate says anything", () => {
    expect(hasCandidateSpeech(TRANSCRIPT)).toBe(true);
  });
});
