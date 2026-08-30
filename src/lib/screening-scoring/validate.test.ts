import { describe, expect, it } from "vitest";
import {
  ScreeningEvidenceValidationError,
  validateScreeningEvidence,
} from "./validate";
import { buildCandidateSpeech } from "./transcript";
import type { EvidenceLevel, ScreeningEvidenceResponse } from "./evidence";
import type { TranscriptTurn } from "./transcript";

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

function finding(
  overrides: Partial<ScreeningEvidenceResponse["dimensions"][number]> = {},
): ScreeningEvidenceResponse["dimensions"][number] {
  return {
    dimension_id: "d1",
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
  dimensions: ScreeningEvidenceResponse["dimensions"],
): ScreeningEvidenceResponse {
  return { dimensions, extraction_summary: "Two competencies covered." };
}

describe("validateScreeningEvidence — structural failures", () => {
  it("rejects the run when the finding count does not match the rubric", () => {
    expect(() =>
      validateScreeningEvidence({
        response: response([finding()]),
        dimensionIds: ["d1", "d2"],
        candidateSpeech: SPEECH,
      }),
    ).toThrow(ScreeningEvidenceValidationError);
  });

  it("rejects the run when a dimension is reported twice", () => {
    expect(() =>
      validateScreeningEvidence({
        response: response([finding(), finding()]),
        dimensionIds: ["d1", "d2"],
        candidateSpeech: SPEECH,
      }),
    ).toThrow(/more than once/);
  });

  it("rejects the run when a rubric dimension has no evidence at all", () => {
    expect(() =>
      validateScreeningEvidence({
        response: response([finding(), finding({ dimension_id: "d3" })]),
        dimensionIds: ["d1", "d2"],
        candidateSpeech: SPEECH,
      }),
    ).toThrow(/No evidence was returned for dimension d2/);
  });

  /**
   * The deterministic scorer zips findings against the rubric by index, so the
   * order here is load-bearing rather than cosmetic: a model that answers out
   * of order must not shift every dimension's score onto its neighbour.
   */
  it("returns findings in rubric order, not the order the model returned them", () => {
    const result = validateScreeningEvidence({
      response: response([finding({ dimension_id: "d2" }), finding({ dimension_id: "d1" })]),
      dimensionIds: ["d1", "d2"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions.map((d) => d.dimension_id)).toEqual(["d1", "d2"]);
  });
});

describe("validateScreeningEvidence — quote verification", () => {
  it("keeps a level whose quote appears in the candidate's speech", () => {
    const result = validateScreeningEvidence({
      response: response([finding()]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("strong");
    expect(result.dimensions[0].evidence_items).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("discards a quote the candidate never said and downgrades the level", () => {
    const result = validateScreeningEvidence({
      response: response([
        finding({
          evidence_items: [
            {
              quote: "I rewrote the entire platform in Rust over a weekend",
              turn_index: 1,
              explanation: "Invented.",
            },
          ],
        }),
      ]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("unclear");
    expect(result.dimensions[0].reported_evidence_level).toBe("strong");
    expect(result.dimensions[0].evidence_items).toEqual([]);
    expect(result.warnings[0]).toMatch(/could not be found/);
  });

  /**
   * The load-bearing one. The interviewer's turn contains the topic of every
   * question by construction, so a quote lifted from it would verify against
   * the full transcript and award credit for the topic merely having been
   * raised. Verification runs against the candidate's speech alone.
   */
  it("refuses a quote taken from the interviewer rather than the candidate", () => {
    const result = validateScreeningEvidence({
      response: response([
        finding({
          evidence_items: [
            {
              quote: "Tell me about a system you scaled past its first design",
              turn_index: 0,
              explanation: "This is the question, not the answer.",
            },
          ],
        }),
      ]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("unclear");
    expect(result.dimensions[0].evidence_items).toEqual([]);
  });

  it("downgrades a level asserted with no quote at all", () => {
    const result = validateScreeningEvidence({
      response: response([finding({ evidence_level: "very_strong", evidence_items: [] })]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("unclear");
    expect(result.warnings[0]).toMatch(/no supporting quote/);
  });

  it("keeps only the quotes that verify when a level ships several", () => {
    const result = validateScreeningEvidence({
      response: response([
        finding({
          evidence_items: [
            { quote: "We moved the billing service", turn_index: 1, explanation: "real" },
            { quote: "I led a team of forty", turn_index: 1, explanation: "invented" },
          ],
        }),
      ]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("strong");
    expect(result.dimensions[0].evidence_items).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("discards evidence attached to a not_present verdict rather than trusting either half", () => {
    const result = validateScreeningEvidence({
      response: response([finding({ evidence_level: "not_present" })]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("not_present");
    expect(result.dimensions[0].evidence_items).toEqual([]);
    expect(result.warnings[0]).toMatch(/were discarded/);
  });

  it("matches a quote across cosmetic punctuation and case differences", () => {
    const result = validateScreeningEvidence({
      response: response([
        finding({
          evidence_items: [
            {
              quote: "READ-REPLICA SETUP AFTER IT STARTED TIMING OUT",
              turn_index: 1,
              explanation: "Same words.",
            },
          ],
        }),
      ]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("strong");
  });

  /**
   * Evidence is per competency, not per question — so a candidate who proves a
   * dimension while answering some other question has still proved it. This is
   * the behaviour per-question scoring could not express.
   */
  it("credits evidence found anywhere in the call, not only where it was asked for", () => {
    const result = validateScreeningEvidence({
      response: response([
        finding({
          dimension_id: "d1",
          evidence_items: [
            {
              // Said while answering the motivation question, not the scaling one.
              quote: "I want to own a product surface end to end",
              turn_index: 3,
              explanation: "Ownership, evidenced in a different answer.",
            },
          ],
        }),
      ]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    expect(result.dimensions[0].evidence_level).toBe("strong");
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
      response: response([finding({ evidence_level: level })]),
      dimensionIds: ["d1"],
      candidateSpeech: SPEECH,
    });

    const before = RANK.get(level) ?? 0;
    const after = RANK.get(result.dimensions[0].evidence_level) ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  });
});
