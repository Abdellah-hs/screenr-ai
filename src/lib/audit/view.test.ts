import { describe, expect, it } from "vitest";
import {
  activeAuditFilterCount,
  auditCandidateCell,
  auditPageCount,
  auditRangeLabel,
  auditScoreCell,
  auditStageLabel,
  auditStageTone,
  auditTimeParts,
  recruiterActionLabel,
} from "./view";

describe("auditStageTone", () => {
  it("groups a stage under the pipeline family it belongs to", () => {
    expect(auditStageTone("resume_parsing")).toBe("resume");
    expect(auditStageTone("resume_scoring")).toBe("resume");
    expect(auditStageTone("screening_scoring")).toBe("screening");
    expect(auditStageTone("interview_scoring")).toBe("interview");
  });

  it("falls back to a neutral tone for a stage it has never seen", () => {
    expect(auditStageTone("take_home_scoring")).toBe("other");
  });
});

describe("auditStageLabel", () => {
  it("uses the recruiter-facing label for a known stage", () => {
    expect(auditStageLabel("screening_scoring")).toBe("Screening scoring");
  });

  it("title-cases an unknown stage rather than blanking the cell", () => {
    expect(auditStageLabel("take_home_scoring")).toBe("Take Home Scoring");
  });
});

describe("auditScoreCell", () => {
  it("labels a résumé score as a ranking, not a grade out of a hundred", () => {
    const cell = auditScoreCell({ stage: "resume_scoring", parsed_score: 80 });

    expect(cell).toEqual({ kind: "score", value: 80, unit: "rank" });
  });

  it("keeps the denominator on a graded stage", () => {
    const cell = auditScoreCell({ stage: "screening_scoring", parsed_score: 61 });

    expect(cell).toEqual({ kind: "score", value: 61, unit: "/100" });
  });

  it("reports zero as a score, never as an absence", () => {
    const cell = auditScoreCell({ stage: "screening_scoring", parsed_score: 0 });

    expect(cell.kind).toBe("score");
  });

  it("says a parsing row produces no score at all", () => {
    const cell = auditScoreCell({ stage: "resume_parsing", parsed_score: null });

    expect(cell).toMatchObject({ kind: "absent", label: "No score" });
  });

  it("says an unscored résumé was never ranked, because a must-have failed", () => {
    const cell = auditScoreCell({ stage: "resume_scoring", parsed_score: null });

    expect(cell).toMatchObject({ kind: "absent", label: "Not ranked" });
  });

  it("falls back to 'not recorded' for a graded stage with no number", () => {
    const cell = auditScoreCell({ stage: "interview_scoring", parsed_score: null });

    expect(cell).toMatchObject({ kind: "absent", label: "Not recorded" });
  });
});

describe("auditCandidateCell", () => {
  it("names the candidate when the row has one", () => {
    const cell = auditCandidateCell({ candidate_id: "c1", candidate_name: "Abdellah Hasnaoui" });

    expect(cell).toEqual({ kind: "named", text: "Abdellah Hasnaoui", hint: null });
  });

  it("distinguishes a row logged before the candidate existed", () => {
    const cell = auditCandidateCell({ candidate_id: null, candidate_name: null });

    expect(cell).toMatchObject({ kind: "absent", text: "Not linked yet" });
  });

  it("distinguishes a candidate whose parse returned no name", () => {
    const cell = auditCandidateCell({ candidate_id: "c1", candidate_name: null });

    expect(cell).toMatchObject({ kind: "absent", text: "Unnamed candidate" });
  });
});

describe("recruiterActionLabel", () => {
  it("reads a state as the event it was", () => {
    expect(recruiterActionLabel("interview_invited")).toBe("Interview invite sent");
  });

  it("title-cases a state it does not recognise", () => {
    expect(recruiterActionLabel("some_future_state")).toBe("Some Future State");
  });
});

describe("activeAuditFilterCount", () => {
  it("counts nothing on an untouched filter set", () => {
    expect(activeAuditFilterCount({})).toBe(0);
  });

  it("ignores pagination, which is not a narrowing", () => {
    expect(activeAuditFilterCount({ page: 3 })).toBe(0);
  });

  it("ignores an unticked checkbox and an empty select", () => {
    expect(activeAuditFilterCount({ overriddenOnly: false, stage: "" })).toBe(0);
  });

  it("counts each active narrowing once", () => {
    const count = activeAuditFilterCount({
      campaignId: "c1",
      stage: "resume_scoring",
      from: "2026-08-01",
      overriddenOnly: true,
      page: 2,
    });

    expect(count).toBe(4);
  });
});

describe("auditRangeLabel", () => {
  it("says so when nothing matched", () => {
    expect(auditRangeLabel(0, 50, 0)).toBe("No decisions");
  });

  it("gives a plain count when everything fits on one page", () => {
    expect(auditRangeLabel(0, 50, 7)).toBe("7 decisions");
    expect(auditRangeLabel(0, 50, 1)).toBe("1 decision");
  });

  it("gives the range being shown when it does not", () => {
    expect(auditRangeLabel(0, 50, 171)).toBe("1–50 of 171");
    expect(auditRangeLabel(3, 50, 171)).toBe("151–171 of 171");
  });
});

describe("auditPageCount", () => {
  it("is one page for an empty result, never zero", () => {
    expect(auditPageCount(0, 50)).toBe(1);
  });

  it("rounds a partial last page up", () => {
    expect(auditPageCount(171, 50)).toBe(4);
    expect(auditPageCount(100, 50)).toBe(2);
  });
});

describe("auditTimeParts", () => {
  it("splits an instant into a dated line and a time line", () => {
    const parts = auditTimeParts("2026-08-25T23:27:00.000Z", "UTC");

    expect(parts.date).toBe("25 Aug 2026");
    expect(parts.time).toBe("23:27");
  });

  it("keeps the year, because an audit trail outlives one", () => {
    expect(auditTimeParts("2025-01-02T09:05:00.000Z", "UTC").date).toContain("2025");
  });

  it("does not throw on a value that is not a date", () => {
    expect(auditTimeParts("not-a-date").date).toBe("Unknown date");
  });
});
