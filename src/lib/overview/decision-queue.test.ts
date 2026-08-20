import { describe, expect, it } from "vitest";
import {
  decisionQueueHeadline,
  groupDecisionQueue,
  toDecisionItem,
  type DecisionItem,
  type DecisionRow,
} from "./decision-queue";
import type { ApplicationState, SlaTimer } from "@/lib/constants";

const NOW = new Date("2026-08-20T12:00:00Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

const INTERVIEW_TIMER: SlaTimer[] = [
  {
    stage: "interview",
    time_limit_hours: 72,
    alert_threshold_hours: 48,
    escalation_threshold_hours: 72,
  },
];

function row(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    applicationId: "a1",
    campaignId: "c1",
    campaignTitle: "Senior Backend Engineer",
    campaignStatus: "active",
    candidateName: "Tobias Lindqvist",
    status: "interview_scored",
    updatedAt: hoursAgo(2),
    resumeScore: 70,
    screeningScore: 75,
    interviewScore: 61,
    tier: "moderate",
    ...overrides,
  };
}

function item(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    applicationId: "a1",
    campaignId: "c1",
    campaignTitle: "Senior Backend Engineer",
    candidateName: "Tobias Lindqvist",
    status: "interview_scored",
    stage: "interview",
    score: 61,
    tier: "moderate",
    hoursInStage: 2,
    sla: null,
    ...overrides,
  };
}

describe("toDecisionItem", () => {
  it("shows the score the current stage produced, not an earlier one", () => {
    const resolved = toDecisionItem(row({ status: "screening_review_pending" }), [], NOW);

    // screening_review_pending buckets to `applied`, so the resume score is the
    // only honest number to put beside the name.
    expect(resolved.score).toBe(70);
  });

  it("shows no score for a stage that produces none", () => {
    const resolved = toDecisionItem(row({ status: "manager_review" }), [], NOW);

    expect(resolved.score).toBeNull();
  });

  it("marks an application past its stage SLA", () => {
    const resolved = toDecisionItem(
      row({ updatedAt: hoursAgo(80) }),
      INTERVIEW_TIMER,
      NOW,
    );

    expect(resolved.sla).toMatchObject({ level: "escalation" });
  });

  it("does not age a paused campaign's application against the SLA", () => {
    const resolved = toDecisionItem(
      row({ updatedAt: hoursAgo(80), campaignStatus: "paused" }),
      INTERVIEW_TIMER,
      NOW,
    );

    expect(resolved.sla).toBeNull();
  });
});

describe("groupDecisionQueue", () => {
  it("pulls anything late into one group regardless of what it is waiting for", () => {
    const queue = groupDecisionQueue([
      item({
        applicationId: "late-approval",
        status: "screening_review_pending",
        hoursInStage: 60,
        sla: { level: "alert", hours: 60 },
      }),
      item({
        applicationId: "late-decision",
        status: "interview_scored",
        hoursInStage: 90,
        sla: { level: "escalation", hours: 90 },
      }),
      item({ applicationId: "on-time", status: "interview_scored" }),
    ]);

    const overdue = queue.groups.find((g) => g.key === "overdue");
    expect(overdue?.items.map((i) => i.applicationId)).toEqual([
      "late-decision",
      "late-approval",
    ]);
  });

  it("puts every group in consequence order", () => {
    const queue = groupDecisionQueue([
      item({ status: "screening_expired" }),
      item({ status: "screening_review_pending" }),
      item({ status: "interview_scored" }),
      item({ status: "manager_review", sla: { level: "alert", hours: 60 } }),
    ]);

    expect(queue.groups.map((g) => g.key)).toEqual([
      "overdue",
      "decide",
      "approve",
      "lapsed",
    ]);
  });

  it("orders each group oldest first", () => {
    const queue = groupDecisionQueue([
      item({ applicationId: "recent", hoursInStage: 3 }),
      item({ applicationId: "old", hoursInStage: 200 }),
      item({ applicationId: "middling", hoursInStage: 40 }),
    ]);

    expect(queue.groups[0].items.map((i) => i.applicationId)).toEqual([
      "old",
      "middling",
      "recent",
    ]);
  });

  it("keeps lapsed applications out of the waiting count", () => {
    const queue = groupDecisionQueue([
      item({ status: "interview_scored" }),
      item({ status: "screening_expired" }),
      item({ status: "interview_no_show" }),
      item({ status: "processing_failed" }),
    ]);

    expect(queue.waitingCount).toBe(1);
  });

  it("does not group a lapsed application as overdue even when it is late", () => {
    const queue = groupDecisionQueue([
      item({ status: "screening_expired", sla: { level: "escalation", hours: 300 } }),
    ]);

    expect(queue.groups.map((g) => g.key)).toEqual(["lapsed"]);
    expect(queue.overdueCount).toBe(0);
  });

  it("names the longest wait in the overdue subtitle", () => {
    const queue = groupDecisionQueue([
      item({ hoursInStage: 24 * 12 + 3, sla: { level: "escalation", hours: 291 } }),
      item({ hoursInStage: 24 * 4, sla: { level: "alert", hours: 96 } }),
    ]);

    expect(queue.groups[0].subtitle).toBe(
      "2 people · the oldest has been waiting 12 days",
    );
  });

  it("omits groups that have nobody in them", () => {
    const queue = groupDecisionQueue([item({ status: "interview_scored" })]);

    expect(queue.groups.map((g) => g.key)).toEqual(["decide"]);
  });

  it("places every waiting application in exactly one group", () => {
    const statuses: ApplicationState[] = [
      "screening_review_pending",
      "interview_scored",
      "manager_review",
    ];
    const queue = groupDecisionQueue(statuses.map((status) => item({ status })));

    const total = queue.groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(statuses.length);
  });
});

describe("decisionQueueHeadline", () => {
  it("counts the queue and calls out what is already late", () => {
    const queue = groupDecisionQueue([
      item({ status: "interview_scored", sla: { level: "alert", hours: 60 } }),
      item({ status: "manager_review", sla: { level: "alert", hours: 60 } }),
      item({ status: "screening_review_pending" }),
    ]);

    expect(decisionQueueHeadline(queue)).toBe(
      "3 things need a decision from you. 2 are past their SLA.",
    );
  });

  it("says nothing about SLA when nothing is late", () => {
    const queue = groupDecisionQueue([item({ status: "interview_scored" })]);

    expect(decisionQueueHeadline(queue)).toBe("1 thing needs a decision from you.");
  });

  it("does not count lapsed work as a decision that is owed", () => {
    const queue = groupDecisionQueue([item({ status: "screening_expired" })]);

    expect(decisionQueueHeadline(queue)).toBe(
      "Nothing is waiting on a decision from you.",
    );
  });
});
