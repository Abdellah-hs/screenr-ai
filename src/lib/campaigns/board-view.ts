import {
  toCandidateStage,
  type CampaignStatus,
  type CandidateStage,
  type SlaTimer,
} from "@/lib/constants";
import { applicationSlaStatus } from "@/lib/rules/sla";

/**
 * One application, reduced to the three facts the campaigns board needs: where
 * it sits, when it last moved, and which campaign it belongs to. Deliberately
 * not the full `Candidate` — the list renders one row per *campaign*, and
 * hydrating every applicant to draw six numbers is how a list of ten campaigns
 * becomes a slow page.
 */
export interface BoardApplication {
  campaignId: string;
  status: string;
  /** Bumped on every transition/score write — the "last moved" proxy SLA uses. */
  updatedAt: string;
}

function emptyBuckets(): Record<CandidateStage, number> {
  return {
    applied: 0,
    screening: 0,
    interview: 0,
    final_interview: 0,
    hired: 0,
    rejected: 0,
  };
}

/** States where an application is waiting on a person, not on a candidate. */
const PENDING_REVIEW_STATE = "screening_review_pending";
const AWAITING_DECISION_STATES = new Set(["interview_scored", "manager_review"]);

/**
 * What a campaign is asking of its owner right now — **one** thing, the most
 * consequential, not a tally.
 *
 * A column that lists everything outstanding is a column nobody reads: the
 * point of scanning a list of campaigns is to find the one to open next, and
 * that decision is made by the worst thing waiting, not by the sum. The order
 * below is the order in which ignoring something costs a candidate:
 * lateness first (it has already cost them), then work queued on a person,
 * then a configuration hole that will silently block the queue.
 */
export type CampaignAttentionKind =
  | "past_sla"
  | "to_approve"
  | "to_decide"
  | "no_questions"
  | "none";

export interface CampaignAttention {
  kind: CampaignAttentionKind;
  count: number;
  label: string;
  /** Rank for "sort by work waiting" — higher is more urgent. */
  rank: number;
}

const NOTHING_WAITING: CampaignAttention = {
  kind: "none",
  count: 0,
  label: "Nothing waiting",
  rank: 0,
};

export interface CampaignBoardCounts {
  total: number;
  buckets: Record<CandidateStage, number>;
  /** Everyone still moving — total minus the two terminal buckets. */
  active: number;
  overdue: number;
  pendingReview: number;
  awaitingDecision: number;
}

export interface CampaignBoardSummary extends CampaignBoardCounts {
  attention: CampaignAttention;
}

/**
 * Roll a campaign's applications into the counts the board draws, plus its SLA
 * breaches.
 *
 * SLA is evaluated only on **active** campaigns, matching
 * `fetchSlaBreachNotifications` and the bell: a paused campaign's candidates are
 * frozen on purpose, and counting their idle hours as lateness would flag the
 * recruiter for a decision they already made. Pure; `now` is injectable.
 */
export function summariseCampaign(
  applications: BoardApplication[],
  options: {
    status: CampaignStatus;
    slaTimers: SlaTimer[];
    screeningQuestionCount: number;
    now?: Date;
  },
): CampaignBoardSummary {
  const { status, slaTimers, screeningQuestionCount, now = new Date() } = options;
  const buckets = emptyBuckets();
  let overdue = 0;
  let pendingReview = 0;
  let awaitingDecision = 0;

  const slaApplies = status === "active" && slaTimers.length > 0;

  for (const app of applications) {
    const stage = toCandidateStage(app.status);
    buckets[stage] += 1;

    if (app.status === PENDING_REVIEW_STATE) pendingReview += 1;
    if (AWAITING_DECISION_STATES.has(app.status)) awaitingDecision += 1;

    if (slaApplies && applicationSlaStatus(stage, app.updatedAt, slaTimers, now)) {
      overdue += 1;
    }
  }

  const total = applications.length;
  const active = total - buckets.hired - buckets.rejected;

  return {
    total,
    buckets,
    active,
    overdue,
    pendingReview,
    awaitingDecision,
    attention: campaignAttention({
      status,
      overdue,
      pendingReview,
      awaitingDecision,
      screeningQuestionCount,
    }),
  };
}

/**
 * Pick the single thing a campaign needs from its owner. Pure and exported so
 * the ordering is testable on its own — it is a product decision, not a
 * rendering detail.
 */
export function campaignAttention(input: {
  status: CampaignStatus;
  overdue: number;
  pendingReview: number;
  awaitingDecision: number;
  screeningQuestionCount: number;
}): CampaignAttention {
  const { status, overdue, pendingReview, awaitingDecision, screeningQuestionCount } =
    input;

  if (overdue > 0) {
    return { kind: "past_sla", count: overdue, label: `${overdue} past SLA`, rank: 4 };
  }
  if (pendingReview > 0) {
    return {
      kind: "to_approve",
      count: pendingReview,
      label: `${pendingReview} to approve`,
      rank: 3,
    };
  }
  if (awaitingDecision > 0) {
    return {
      kind: "to_decide",
      count: awaitingDecision,
      label: `${awaitingDecision} to decide`,
      rank: 2,
    };
  }
  // A closed campaign that never got questions is not a hole worth flagging —
  // nobody is going to be approved into screening on it again.
  if (screeningQuestionCount === 0 && status !== "closed") {
    return { kind: "no_questions", count: 0, label: "No questions set", rank: 1 };
  }
  return NOTHING_WAITING;
}

/**
 * The one-line description of a campaign's pipeline shape.
 *
 * Status-aware because the same six numbers mean different things: a paused
 * campaign's 23 people are frozen on purpose, a closed campaign's are a result,
 * and a draft has no pipeline because its apply link isn't live yet. One
 * sentence per situation beats one sentence that is true in none of them.
 */
export function pipelineSummaryText(
  counts: Pick<CampaignBoardCounts, "total" | "buckets">,
  status: CampaignStatus,
): string {
  const { total, buckets } = counts;

  if (total === 0) {
    return status === "draft"
      ? "No pipeline yet — the apply link goes live when you set this to Active"
      : "Nobody has applied yet";
  }

  const people = `${total} ${total === 1 ? "person" : "people"}`;

  if (status === "paused") return `${people} · frozen mid-pipeline`;
  if (status === "closed") {
    return `${people} · ${buckets.hired} hired · ${buckets.rejected} closed`;
  }

  const parts: string[] = [];
  if (buckets.applied > 0) parts.push(`${buckets.applied} new`);
  if (buckets.screening > 0) parts.push(`${buckets.screening} screening`);
  // Named even at zero: "nobody has reached the interview" is the fact a
  // recruiter is scanning for, and an omitted segment reads as an oversight.
  parts.push(buckets.interview > 0 ? `${buckets.interview} interview` : "none interviewed");

  return `${people} · ${parts.join(" · ")}`;
}
