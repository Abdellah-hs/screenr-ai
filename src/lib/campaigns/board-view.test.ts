import { describe, expect, it } from "vitest";
import {
  campaignAttention,
  pipelineSummaryText,
  summariseCampaign,
  type BoardApplication,
} from "./board-view";
import type { CandidateStage, SlaTimer } from "@/lib/constants";

const NOW = new Date("2026-08-20T12:00:00Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

const SCREENING_TIMER: SlaTimer[] = [
  {
    stage: "screening",
    time_limit_hours: 72,
    alert_threshold_hours: 48,
    escalation_threshold_hours: 72,
  },
];

function app(status: string, updatedAt = hoursAgo(1)): BoardApplication {
  return { campaignId: "c1", status, updatedAt };
}

describe("summariseCampaign", () => {
  it("buckets applications into the six pipeline stages", () => {
    const applications = [
      app("new"),
      app("resume_scored"),
      app("screening_sent"),
      app("interview_invited"),
      app("hired"),
      app("rejected"),
    ];

    const summary = summariseCampaign(applications, {
      status: "active",
      slaTimers: [],
      screeningQuestionCount: 3,
      now: NOW,
    });

    expect(summary.buckets).toEqual({
      applied: 2,
      screening: 1,
      interview: 1,
      final_interview: 0,
      hired: 1,
      rejected: 1,
    });
  });

  it("counts everyone but the two terminal buckets as active", () => {
    const summary = summariseCampaign(
      [app("new"), app("screening_sent"), app("hired"), app("rejected")],
      { status: "active", slaTimers: [], screeningQuestionCount: 1, now: NOW },
    );

    expect(summary.active).toBe(2);
  });

  it("counts an application past its stage SLA as overdue", () => {
    const summary = summariseCampaign([app("screening_sent", hoursAgo(80))], {
      status: "active",
      slaTimers: SCREENING_TIMER,
      screeningQuestionCount: 1,
      now: NOW,
    });

    expect(summary.overdue).toBe(1);
  });

  it("does not age a paused campaign's candidates against the SLA", () => {
    const summary = summariseCampaign([app("screening_sent", hoursAgo(80))], {
      status: "paused",
      slaTimers: SCREENING_TIMER,
      screeningQuestionCount: 1,
      now: NOW,
    });

    expect(summary.overdue).toBe(0);
  });

  it("counts applications waiting on a human review", () => {
    const summary = summariseCampaign(
      [app("screening_review_pending"), app("screening_review_pending"), app("new")],
      { status: "active", slaTimers: [], screeningQuestionCount: 1, now: NOW },
    );

    expect(summary.pendingReview).toBe(2);
  });

  it("counts both post-interview waiting states as awaiting a decision", () => {
    const summary = summariseCampaign(
      [app("interview_scored"), app("manager_review")],
      { status: "active", slaTimers: [], screeningQuestionCount: 1, now: NOW },
    );

    expect(summary.awaitingDecision).toBe(2);
  });
});

describe("campaignAttention", () => {
  const base = {
    status: "active" as const,
    overdue: 0,
    pendingReview: 0,
    awaitingDecision: 0,
    screeningQuestionCount: 3,
  };

  it("ranks lateness above every other kind of waiting work", () => {
    const attention = campaignAttention({
      ...base,
      overdue: 2,
      pendingReview: 9,
      awaitingDecision: 4,
    });

    expect(attention).toMatchObject({ kind: "past_sla", count: 2, label: "2 past SLA" });
  });

  it("ranks approvals above decisions", () => {
    const attention = campaignAttention({ ...base, pendingReview: 4, awaitingDecision: 7 });

    expect(attention).toMatchObject({ kind: "to_approve", label: "4 to approve" });
  });

  it("surfaces a missing question set when nothing else is waiting", () => {
    const attention = campaignAttention({ ...base, screeningQuestionCount: 0 });

    expect(attention).toMatchObject({ kind: "no_questions", label: "No questions set" });
  });

  it("does not flag missing questions on a closed campaign", () => {
    const attention = campaignAttention({
      ...base,
      status: "closed",
      screeningQuestionCount: 0,
    });

    expect(attention.kind).toBe("none");
  });

  it("says so plainly when nothing is waiting", () => {
    expect(campaignAttention(base)).toMatchObject({
      kind: "none",
      label: "Nothing waiting",
      rank: 0,
    });
  });

  it("orders the kinds so a sort by rank is worst-first", () => {
    const ranks = [
      campaignAttention({ ...base, overdue: 1 }).rank,
      campaignAttention({ ...base, pendingReview: 1 }).rank,
      campaignAttention({ ...base, awaitingDecision: 1 }).rank,
      campaignAttention({ ...base, screeningQuestionCount: 0 }).rank,
      campaignAttention(base).rank,
    ];

    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });
});

describe("pipelineSummaryText", () => {
  function counts(partial: Partial<Record<CandidateStage, number>>) {
    const buckets = {
      applied: 0,
      screening: 0,
      interview: 0,
      final_interview: 0,
      hired: 0,
      rejected: 0,
      ...partial,
    };
    return { total: Object.values(buckets).reduce((a, b) => a + b, 0), buckets };
  }

  it("explains an empty draft by its apply link, not by its emptiness", () => {
    expect(pipelineSummaryText(counts({}), "draft")).toBe(
      "No pipeline yet — the apply link goes live when you set this to Active",
    );
  });

  it("says nobody has applied when a live campaign is empty", () => {
    expect(pipelineSummaryText(counts({}), "active")).toBe("Nobody has applied yet");
  });

  it("lists the forward stages for a live campaign", () => {
    const text = pipelineSummaryText(
      counts({ applied: 38, screening: 31, interview: 19, rejected: 29 }),
      "active",
    );

    expect(text).toBe("117 people · 38 new · 31 screening · 19 interview");
  });

  it("names the interview stage even when nobody has reached it", () => {
    const text = pipelineSummaryText(counts({ applied: 22, screening: 3 }), "active");

    expect(text).toBe("25 people · 22 new · 3 screening · none interviewed");
  });

  it("says a paused pipeline is frozen rather than reporting its stages", () => {
    const text = pipelineSummaryText(counts({ applied: 12, screening: 11 }), "paused");

    expect(text).toBe("23 people · frozen mid-pipeline");
  });

  it("reports a closed campaign as an outcome", () => {
    const text = pipelineSummaryText(counts({ hired: 1, rejected: 30 }), "closed");

    expect(text).toBe("31 people · 1 hired · 30 closed");
  });

  it("uses the singular for one applicant", () => {
    expect(pipelineSummaryText(counts({ applied: 1 }), "active")).toBe(
      "1 person · 1 new · none interviewed",
    );
  });
});
