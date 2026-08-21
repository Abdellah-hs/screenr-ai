import { describe, expect, it } from "vitest";
import {
  ScreeningEvidenceValidationError,
  validateScreeningEvidence,
} from "./validate";
import { buildCandidateSpeech } from "./transcript";
import type { EvidenceLevel, ScreeningEvidenceResponse, TranscriptTurn } from "./evidence";

const TRANSCRIPT: TranscriptTurn[] = [
  {
    role: "agent",
    text: "Tell me about a system you scaled past its first design.",
    at: "2026-08-21T10:00:00.000Z",
  },
  {
    role: "candidate",
    text: "We moved the billing service off a single Postgres box to a read-replica setup after it started timing out at month end.",
    at: "2026-08-21T10:00:20.000Z",
  },
  {
    role: "agent",
    text: "What made you look outside your current role?",
    at: "2026-08-21T10:01:00.000Z",
  },
  {
    role: "candidate",
    text: "I want to own a product surface end to end rather than only the data layer.",
    at: "2026-08-21T10:01:15.000Z",
  },
];

const SPEECH = buildCandidateSpeech(TRANSCRIPT);

function answer(
  overrides: Partial<ScreeningEvidenceResponse["answers"][number]> = {},
): ScreeningEvidenceResponse["answers"][number] {
  return {
    question_id: "q1",
    evidence_level: "strong",
    evidence_items: [
      {
        quote: "We moved the billing service off a single Postgres box",
        turn_index: 1,
        explanation: "Describes a concrete scaling change.",
      },
    ],
    notes: null,
    ...overrides,
  };
}

function response(
  answers: ScreeningEvidenceResponse["answers"],
): ScreeningEvidenceResponse {
  return { answers, extraction_summary: "Two questions covered." };
}

describe("validateScreeningEvidence — structural failures", () => {
  it("rejects the run when the answer count does not match the questions", () => {
    expect(() =>
      validateScreeningEvidence({
        response: response([answer()]),
        questionIds: ["q1", "q2"],
        candidateSpeech: SPEECH,
      }),
    ).toThrow(ScreeningEvidenceValidationError);
  });

  it("rejects the run when a question is answered twice", () => {
    expect(() =>
      validateScreeningEvidence({
        response: response([answer(), answer()]),
        questionIds: ["q1", "q2"],
        candidateSpeech: SPEECH,
      }),
    ).toThrow(/more than once/);
  });

  it("rejects the run when a question has no evidence at all", () => {
    expect(() =>
      validateScreeningEvidence({
        response: response([answer(), answer({ question_id: "q3" })]),
        questionIds: ["q1", "q2"],
        candidateSpeech: SPEECH,
      }),
    ).toThrow(/No evidence was returned for question q2/);
  });

  it("returns answers in the order the questions were asked, not the order returned", () => {
    const result = validateScreeningEvidence({
      response: response([answer({ question_id: "q2" }), answer({ question_id: "q1" })]),
      questionIds: ["q1", "q2"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers.map((a) => a.question_id)).toEqual(["q1", "q2"]);
  });
});

describe("validateScreeningEvidence — quote verification", () => {
  it("keeps a level whose quote appears in the candidate's speech", () => {
    const result = validateScreeningEvidence({
      response: response([answer()]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("strong");
    expect(result.answers[0].evidence_items).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("discards a quote the candidate never said and downgrades the level", () => {
    const result = validateScreeningEvidence({
      response: response([
        answer({
          evidence_items: [
            {
              quote: "I rewrote the entire platform in Rust over a weekend",
              turn_index: 1,
              explanation: "Invented.",
            },
          ],
        }),
      ]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("unclear");
    expect(result.answers[0].reported_evidence_level).toBe("strong");
    expect(result.answers[0].evidence_items).toEqual([]);
    expect(result.warnings[0]).toMatch(/could not be found/);
  });

  /**
   * The load-bearing one. The interviewer's turn contains the topic of every
   * question by construction, so a quote lifted from it would verify against
   * the full transcript and award credit for the question merely having been
   * asked. Verification runs against the candidate's speech alone.
   */
  it("refuses a quote taken from the interviewer rather than the candidate", () => {
    const result = validateScreeningEvidence({
      response: response([
        answer({
          evidence_items: [
            {
              quote: "Tell me about a system you scaled past its first design",
              turn_index: 0,
              explanation: "This is the question, not the answer.",
            },
          ],
        }),
      ]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("unclear");
    expect(result.answers[0].evidence_items).toEqual([]);
  });

  it("downgrades a level asserted with no quote at all", () => {
    const result = validateScreeningEvidence({
      response: response([answer({ evidence_level: "very_strong", evidence_items: [] })]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("unclear");
    expect(result.warnings[0]).toMatch(/no supporting quote/);
  });

  it("keeps only the quotes that verify when a level ships several", () => {
    const result = validateScreeningEvidence({
      response: response([
        answer({
          evidence_items: [
            { quote: "We moved the billing service", turn_index: 1, explanation: "real" },
            { quote: "I led a team of forty", turn_index: 1, explanation: "invented" },
          ],
        }),
      ]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("strong");
    expect(result.answers[0].evidence_items).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("discards evidence attached to a not_present verdict rather than trusting either half", () => {
    const result = validateScreeningEvidence({
      response: response([answer({ evidence_level: "not_present" })]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("not_present");
    expect(result.answers[0].evidence_items).toEqual([]);
    expect(result.warnings[0]).toMatch(/were discarded/);
  });

  it("matches a quote across cosmetic punctuation and case differences", () => {
    const result = validateScreeningEvidence({
      response: response([
        answer({
          evidence_items: [
            {
              // Curly apostrophe and different casing than the transcript.
              quote: "READ-REPLICA SETUP AFTER IT STARTED TIMING OUT",
              turn_index: 1,
              explanation: "Same words.",
            },
          ],
        }),
      ]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    expect(result.answers[0].evidence_level).toBe("strong");
  });
});

describe("validateScreeningEvidence — the transcript outranks the model", () => {
  it("forces not_present for a question code already found unanswered", () => {
    const result = validateScreeningEvidence({
      response: response([answer({ evidence_level: "very_strong" })]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
      unansweredQuestionIds: new Set(["q1"]),
    });

    expect(result.answers[0].evidence_level).toBe("not_present");
    expect(result.answers[0].reported_evidence_level).toBe("very_strong");
    expect(result.warnings[0]).toMatch(/never reached/);
  });

  it("does not warn when the model agreed the question was never reached", () => {
    const result = validateScreeningEvidence({
      response: response([answer({ evidence_level: "not_present", evidence_items: [] })]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
      unansweredQuestionIds: new Set(["q1"]),
    });

    expect(result.answers[0].evidence_level).toBe("not_present");
    expect(result.warnings).toEqual([]);
  });
});

describe("validateScreeningEvidence — validation never raises a level", () => {
  const LEVELS: EvidenceLevel[] = [
    "not_present",
    "unclear",
    "weak",
    "partial",
    "strong",
    "very_strong",
  ];
  const RANK = new Map(LEVELS.map((l, i) => [l, i]));

  it.each(LEVELS)("leaves %s no higher than the model reported it", (level) => {
    const result = validateScreeningEvidence({
      response: response([answer({ evidence_level: level })]),
      questionIds: ["q1"],
      candidateSpeech: SPEECH,
    });

    const before = RANK.get(level) ?? 0;
    const after = RANK.get(result.answers[0].evidence_level) ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  });
});
