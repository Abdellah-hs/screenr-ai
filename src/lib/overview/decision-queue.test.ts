import { describe, expect, it } from "vitest";
import {
  DECISION_QUEUE_STATES,
  describeWait,
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
    resumeTier: "eligible",
    screeningScore: 75,
    interviewScore: 61,
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
    scoreStage: "interview",
    tier: null,
    hoursInStage: 2,
    sla: null,
    ...overrides,
  };
}

describe("DECISION_QUEUE_STATES", () => {
  // The bell (`data/notifications.ts`) and the campaign board
  // (`campaigns/board-view.ts`) both count `screening_scored` as awaiting a
  // person. Leaving it out here made the bell claim work the overview refused
  // to name.
  it("includes every state that is waiting on a human decision", () => {
    expect(DECISION_QUEUE_STATES).toEqual(
      expect.arrayContaining(["screening_scored", "interview_scored", "manager_review"]),
    );
  });
});

describe("toDecisionItem", () => {
  it("shows the resume score, and its tier, for a CV awaiting approval", () => {
    const resolved = toDecisionItem(row({ status: "screening_review_pending" }), [], NOW);

    expect(resolved).toMatchObject({ score: 70, scoreStage: "resume", tier: "eligible" });
  });

  it("shows the screening score once the call has been scored", () => {
    const resolved = toDecisionItem(row({ status: "screening_scored" }), [], NOW);

    expect(resolved).toMatchObject({ score: 75, scoreStage: "screening" });
  });

  it("shows the interview score for a candidate handed to a manager", () => {
    // `manager_review` buckets to `final_interview`, which produces no score of
    // its own — reading the bucket left the whole group blank.
    const resolved = toDecisionItem(row({ status: "manager_review" }), [], NOW);

    expect(resolved).toMatchObject({ score: 61, scoreStage: "interview" });
  });

  it("never attaches the resume tier to another stage's score", () => {
    // `applications.screening_tier` is the RESUME verdict. Pinned to an
    // interview score it puts an "Eligible" pill about somebody's CV beside a
    // number no scorer ever banded.
    const resolved = toDecisionItem(row({ status: "interview_scored" }), [], NOW);

    expect(resolved.tier).toBeNull();
  });

  it("shows no score for an application that lapsed", () => {
    const resolved = toDecisionItem(row({ status: "screening_expired" }), [], NOW);

    expect(resolved).toMatchObject({ score: null, scoreStage: null, tier: null });
  });

  it("reports no stage when the stage's score is missing", () => {
    const resolved = toDecisionItem(
      row({ status: "interview_scored", interviewScore: null }),
      [],
      NOW,
    );

    expect(resolved).toMatchObject({ score: null, scoreStage: null });
  });

  it("marks an application past its stage SLA", () => {
    const resolved = toDecisionItem(row({ updatedAt: hoursAgo(80) }), INTERVIEW_TIMER, NOW);

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

describe("describeWait", () => {
  it("says hours rather than flooring a sub-day wait to zero days", () => {
    expect(describeWait(14)).toBe("14 hours");
  });

  it("switches to days once hours stop being readable", () => {
    expect(describeWait(24 * 12 + 3)).toBe("12 days");
  });

  it("does not claim a whole hour before one has passed", () => {
    expect(describeWait(0.4)).toBe("under an hour");
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

  it("queues a screening score below the line as a decision, not an outcome", () => {
    const queue = groupDecisionQueue([item({ status: "screening_scored" })]);

    expect(queue.groups.map((g) => g.key)).toEqual(["decide"]);
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

  it("keeps lapsed applications out of the decision groups", () => {
    const queue = groupDecisionQueue([
      item({ status: "interview_scored" }),
      item({ status: "screening_expired" }),
      item({ status: "interview_no_show" }),
      item({ status: "processing_failed" }),
    ]);

    expect(queue.groups.find((g) => g.key === "decide")?.items).toHaveLength(1);
    expect(queue.groups.find((g) => g.key === "lapsed")?.items).toHaveLength(3);
  });

  it("does not group a lapsed application as overdue even when it is late", () => {
    const queue = groupDecisionQueue([
      item({ status: "screening_expired", sla: { level: "escalation", hours: 300 } }),
    ]);

    expect(queue.groups.map((g) => g.key)).toEqual(["lapsed"]);
  });

  it("names the longest wait in the group subtitle", () => {
    const queue = groupDecisionQueue([
      item({ hoursInStage: 24 * 12 + 3, sla: { level: "escalation", hours: 291 } }),
      item({ hoursInStage: 24 * 4, sla: { level: "alert", hours: 96 } }),
    ]);

    expect(queue.groups[0].subtitle).toBe("2 people · longest wait 12 days");
  });

  it("states a sub-day wait in hours rather than as zero days", () => {
    const queue = groupDecisionQueue([
      item({ hoursInStage: 14, sla: { level: "alert", hours: 14 } }),
    ]);

    expect(queue.groups[0].subtitle).toBe("1 person · longest wait 14 hours");
  });

  it("says a lapsed application was not rejected", () => {
    const queue = groupDecisionQueue([item({ status: "screening_expired" })]);

    expect(queue.groups[0].subtitle).toBe("1 person · nobody was rejected");
  });

  it("omits groups that have nobody in them", () => {
    const queue = groupDecisionQueue([item({ status: "interview_scored" })]);

    expect(queue.groups.map((g) => g.key)).toEqual(["decide"]);
  });

  it("places every waiting application in exactly one group", () => {
    const statuses: ApplicationState[] = [
      "screening_review_pending",
      "screening_scored",
      "interview_scored",
      "manager_review",
    ];
    const queue = groupDecisionQueue(statuses.map((status) => item({ status })));

    const total = queue.groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(statuses.length);
  });
});
