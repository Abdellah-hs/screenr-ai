import {
  toCandidateStage,
  type ApplicationState,
  type CandidateStage,
  type ScreeningTier,
  type SlaTimer,
} from "@/lib/constants";
import { applicationSlaStatus, type SlaStatus } from "@/lib/rules/sla";

/**
 * One application on the overview's decision queue, with the evidence a
 * recruiter needs to decide *which* one to open — not to decide the outcome.
 */
export interface DecisionItem {
  applicationId: string;
  campaignId: string;
  campaignTitle: string;
  candidateName: string;
  status: ApplicationState;
  stage: CandidateStage;
  /** The current stage's score, or null when this stage produced none. */
  score: number | null;
  tier: ScreeningTier | null;
  /** Hours since the application last moved. */
  hoursInStage: number;
  sla: SlaStatus | null;
}

/**
 * The raw shape the data layer hands over, before SLA and stage are resolved.
 * `campaignStatus` is here because SLA does not run on a frozen campaign.
 */
export interface DecisionRow {
  applicationId: string;
  campaignId: string;
  campaignTitle: string;
  campaignStatus: string;
  candidateName: string;
  status: ApplicationState;
  updatedAt: string;
  resumeScore: number | null;
  screeningScore: number | null;
  interviewScore: number | null;
  tier: ScreeningTier | null;
}

/** Waiting on a person to approve a CV into screening (human-in-the-loop only). */
const APPROVAL_STATES: ApplicationState[] = ["screening_review_pending"];

/** Waiting on a person to decide, after the AI has taken it as far as it can. */
const DECISION_STATES: ApplicationState[] = ["interview_scored", "manager_review"];

/**
 * Ended without anybody deciding anything. Deliberately separate from the
 * queue: there is no button here that resolves them, and mixing them into the
 * decision groups would inflate the "things waiting on you" count with things
 * that already happened.
 */
const LAPSED_STATES: ApplicationState[] = [
  "screening_expired",
  "interview_expired",
  "interview_no_show",
  "processing_failed",
];

/** Every state the overview queue reads. Used to scope the query. */
export const DECISION_QUEUE_STATES: ApplicationState[] = [
  ...APPROVAL_STATES,
  ...DECISION_STATES,
  ...LAPSED_STATES,
];

export type DecisionGroupKey = "overdue" | "decide" | "approve" | "lapsed";

export interface DecisionGroup {
  key: DecisionGroupKey;
  title: string;
  /** What the group costs if it is ignored — the reason it sits where it does. */
  subtitle: string;
  items: DecisionItem[];
}

export interface DecisionQueue {
  /** In the order they should be worked, worst consequence first. */
  groups: DecisionGroup[];
  /** Everything a person still owes a decision on — lapsed items excluded. */
  waitingCount: number;
  overdueCount: number;
}

/** The score to show beside a name: strictly the one its current stage made. */
function stageScore(row: DecisionRow, stage: CandidateStage): number | null {
  if (stage === "applied") return row.resumeScore;
  if (stage === "screening") return row.screeningScore;
  if (stage === "interview") return row.interviewScore;
  // final_interview and the terminal buckets produce no score of their own; a
  // rollup would be the composite score the PRD forbids.
  return null;
}

/** Resolve one row into a queue item, deciding its SLA standing. Pure. */
export function toDecisionItem(
  row: DecisionRow,
  slaTimers: SlaTimer[],
  now: Date = new Date(),
): DecisionItem {
  const stage = toCandidateStage(row.status);
  const slaApplies = row.campaignStatus === "active";

  return {
    applicationId: row.applicationId,
    campaignId: row.campaignId,
    campaignTitle: row.campaignTitle,
    candidateName: row.candidateName,
    status: row.status,
    stage,
    score: stageScore(row, stage),
    tier: row.tier,
    hoursInStage: (now.getTime() - new Date(row.updatedAt).getTime()) / 3_600_000,
    sla: slaApplies ? applicationSlaStatus(stage, row.updatedAt, slaTimers, now) : null,
  };
}

function days(hours: number): number {
  return Math.floor(hours / 24);
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/**
 * Group the queue by what happens if the recruiter does nothing.
 *
 * Lateness is its own group rather than a badge inside the others, because an
 * overdue approval and an overdue decision are the same job — "someone has been
 * waiting too long" — and splitting them across two sections buries the oldest
 * person on the page under a heading about process. Everything still waiting
 * appears exactly once.
 */
export function groupDecisionQueue(items: DecisionItem[]): DecisionQueue {
  const overdue: DecisionItem[] = [];
  const decide: DecisionItem[] = [];
  const approve: DecisionItem[] = [];
  const lapsed: DecisionItem[] = [];

  for (const item of items) {
    if (LAPSED_STATES.includes(item.status)) {
      lapsed.push(item);
      continue;
    }
    if (item.sla) {
      overdue.push(item);
      continue;
    }
    if (APPROVAL_STATES.includes(item.status)) approve.push(item);
    else if (DECISION_STATES.includes(item.status)) decide.push(item);
  }

  // Oldest first inside every group: the queue exists to surface the person who
  // has been waiting longest, and any other order hides them below the fold.
  const byAge = (a: DecisionItem, b: DecisionItem) => b.hoursInStage - a.hoursInStage;
  overdue.sort(byAge);
  decide.sort(byAge);
  approve.sort(byAge);
  lapsed.sort(byAge);

  const oldestOverdue = overdue[0];
  const groups: DecisionGroup[] = [];

  if (overdue.length > 0) {
    groups.push({
      key: "overdue",
      title: "Past SLA · decide today",
      subtitle: `${people(overdue.length)} · the oldest has been waiting ${days(
        oldestOverdue.hoursInStage,
      )} days`,
      items: overdue,
    });
  }
  if (decide.length > 0) {
    groups.push({
      key: "decide",
      title: "Scored · waiting on a decision",
      subtitle: `${people(decide.length)} · within SLA`,
      items: decide,
    });
  }
  if (approve.length > 0) {
    groups.push({
      key: "approve",
      title: "Approve into screening",
      subtitle: `${people(approve.length)} · human-in-the-loop campaigns only`,
      items: approve,
    });
  }
  if (lapsed.length > 0) {
    groups.push({
      key: "lapsed",
      title: "Lapsed · already happened",
      subtitle: "Nobody was rejected. These need a call, not a click.",
      items: lapsed,
    });
  }

  return {
    groups,
    waitingCount: overdue.length + decide.length + approve.length,
    overdueCount: overdue.length,
  };
}

/**
 * The line under the greeting. It states the size of the queue and then the one
 * thing that changes how you work it — that nothing here advances on its own.
 */
export function decisionQueueHeadline(queue: DecisionQueue): string {
  if (queue.waitingCount === 0) {
    return "Nothing is waiting on a decision from you.";
  }

  const size = `${queue.waitingCount} ${
    queue.waitingCount === 1 ? "thing needs" : "things need"
  } a decision from you.`;

  if (queue.overdueCount === 0) return size;

  return `${size} ${queue.overdueCount} ${
    queue.overdueCount === 1 ? "is" : "are"
  } past their SLA.`;
}
