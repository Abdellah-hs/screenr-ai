import { describe, it, expect } from "vitest";
import {
  hasResumeScore,
  hasScreeningScore,
  isStaleScore,
  summarisePipeline,
  type PipelineRow,
} from "./pipeline-summary";
import type { ApplicationState, SlaTimer } from "@/lib/constants";

const NOW = new Date("2026-08-23T12:00:00.000Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function row(overrides: Partial<PipelineRow> = {}): PipelineRow {
  return {
    status: "new" as ApplicationState,
    created_at: hoursAgo(1),
    updated_at: hoursAgo(1),
    scored_at: null,
    resume_score: null,
    rubric_version: null,
    screening: null,
    ...overrides,
  };
}

const NO_TIMERS: SlaTimer[] = [];

const APPLIED_TIMER: SlaTimer[] = [
  {
    stage: "applied",
    time_limit_hours: 24,
    alert_threshold_hours: 24,
    escalation_threshold_hours: 72,
  },
];

const BASE = {
  slaTimers: NO_TIMERS,
  resumeRubricVersion: null,
  screeningRubricVersion: null,
  now: NOW,
};

describe("hasResumeScore", () => {
  it("counts a scored-but-ineligible candidate, who has no ranking score", () => {
    expect(hasResumeScore({ scored_at: hoursAgo(2), resume_score: null })).toBe(true);
  });

  it("does not count an application that has never been evaluated", () => {
    expect(hasResumeScore({ scored_at: null, resume_score: null })).toBe(false);
  });
});

describe("hasScreeningScore", () => {
  it("counts a response that reached the scored status with a number", () => {
    expect(hasScreeningScore({ status: "scored", overall_score: 71 })).toBe(true);
  });

  it("does not count a response still awaiting scoring", () => {
    expect(hasScreeningScore({ status: "completed", overall_score: null })).toBe(false);
  });

  it("does not count a missing response", () => {
    expect(hasScreeningScore(null)).toBe(false);
  });
});

describe("isStaleScore", () => {
  it("is stale when the score was produced against an older rubric", () => {
    expect(isStaleScore(1, 2)).toBe(true);
  });

  it("is not stale when the versions match", () => {
    expect(isStaleScore(2, 2)).toBe(false);
  });

  it("is not stale when either version is untracked", () => {
    // "Not tracked" is a different claim from "out of date" and must never be
    // badged as one.
    expect(isStaleScore(null, 2)).toBe(false);
    expect(isStaleScore(1, null)).toBe(false);
  });
});

describe("summarisePipeline", () => {
  it("buckets applications into pipeline stages", () => {
    const summary = summarisePipeline(
      [
        row({ status: "new" as ApplicationState }),
        row({ status: "resume_scored" as ApplicationState }),
        row({ status: "screening_sent" as ApplicationState }),
        row({ status: "hired" as ApplicationState }),
      ],
      BASE,
    );

    expect(summary.total).toBe(4);
    expect(summary.stageCounts).toEqual({ applied: 2, screening: 1, hired: 1 });
  });

  it("counts SLA breaches per stage and in total", () => {
    const summary = summarisePipeline(
      [
        // 100h in the applied stage — past both thresholds.
        row({ status: "new" as ApplicationState, updated_at: hoursAgo(100) }),
        // 2h in — comfortably inside the limit.
        row({ status: "new" as ApplicationState, updated_at: hoursAgo(2) }),
      ],
      { ...BASE, slaTimers: APPLIED_TIMER },
    );

    expect(summary.overdueTotal).toBe(1);
    expect(summary.breachesByStage).toEqual({ applied: 1 });
  });

  it("reports no breaches when the campaign has no timer for the stage", () => {
    const summary = summarisePipeline(
      [row({ status: "new" as ApplicationState, updated_at: hoursAgo(500) })],
      BASE,
    );

    expect(summary.overdueTotal).toBe(0);
    expect(summary.breachesByStage).toEqual({});
  });

  it("counts a candidate whose resume score predates the active rubric", () => {
    const summary = summarisePipeline(
      [
        row({ scored_at: hoursAgo(5), rubric_version: 1 }),
        row({ scored_at: hoursAgo(5), rubric_version: 2 }),
      ],
      { ...BASE, resumeRubricVersion: 2 },
    );

    expect(summary.staleScoreCount).toBe(1);
  });

  it("counts a stale screening score even when the resume score is current", () => {
    const summary = summarisePipeline(
      [
        row({
          scored_at: hoursAgo(5),
          rubric_version: 3,
          screening: { status: "scored", overall_score: 64, rubric_version: 1 },
        }),
      ],
      { ...BASE, resumeRubricVersion: 3, screeningRubricVersion: 4 },
    );

    expect(summary.staleScoreCount).toBe(1);
  });

  it("does not call an unscored application stale, whatever the rubric says", () => {
    const summary = summarisePipeline(
      [row({ scored_at: null, resume_score: null, rubric_version: 1 })],
      { ...BASE, resumeRubricVersion: 9 },
    );

    expect(summary.staleScoreCount).toBe(0);
  });

  it("counts a candidate once even when both of their scores are stale", () => {
    const summary = summarisePipeline(
      [
        row({
          scored_at: hoursAgo(5),
          rubric_version: 1,
          screening: { status: "scored", overall_score: 50, rubric_version: 1 },
        }),
      ],
      { ...BASE, resumeRubricVersion: 2, screeningRubricVersion: 2 },
    );

    expect(summary.staleScoreCount).toBe(1);
  });

  it("counts applications received inside the recent window", () => {
    const summary = summarisePipeline(
      [
        row({ created_at: daysAgo(1) }),
        row({ created_at: daysAgo(6) }),
        row({ created_at: daysAgo(30) }),
      ],
      BASE,
    );

    expect(summary.recentApplications).toBe(2);
  });

  it("returns empty counts for a campaign with nobody in it", () => {
    const summary = summarisePipeline([], BASE);

    expect(summary).toEqual({
      total: 0,
      stageCounts: {},
      breachesByStage: {},
      overdueTotal: 0,
      staleScoreCount: 0,
      recentApplications: 0,
    });
  });
});
