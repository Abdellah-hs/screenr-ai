import {
  toCandidateStage,
  type ApplicationState,
  type CandidateScore,
  type CandidateStage,
  type ScreeningTier,
  type SlaTimer,
  AWAITING_DECISION_STATES,
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
  /** The reading beside the name, or null when this state has produced none. */
  score: number | null;
  /** Which scorer wrote `score`. Null exactly when `score` is null. */
  scoreStage: CandidateScore["stage"] | null;
  /** Only ever the resume tier — the one stage whose scorer bands anything. */
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
  /**
   * The verdict on `applications.screening_tier` which — despite the column
   * name — is the **resume** evaluation's tier, written beside `resume_score`
   * by the resume scorer. Named here for what it is, so it cannot be pinned to
   * another stage's number by accident.
   */
  resumeTier: ScreeningTier | null;
  /** From `screening_question_responses.overall_score`, once that row is scored. */
  screeningScore: number | null;
  /** From `interview_sessions.scores.overall_score`. */
  interviewScore: number | null;
}

/** Waiting on a person to approve a CV into screening (human-in-the-loop only). */
const APPROVAL_STATES: ApplicationState[] = ["screening_review_pending"];


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
  ...AWAITING_DECISION_STATES,
  ...LAPSED_STATES,
];

export type DecisionGroupKey = "overdue" | "decide" | "approve" | "lapsed";

export interface DecisionGroup {
  key: DecisionGroupKey;
  title: string;
  /** How many are in the group, and how long the longest has waited. */
  subtitle: string;
  items: DecisionItem[];
}

export interface DecisionQueue {
  /** In the order they should be worked, worst consequence first. */
  groups: DecisionGroup[];
}

/**
 * The reading to show beside a name, chosen by the application STATE rather
 * than its coarse pipeline bucket.
 *
 * The bucket was wrong twice over. `manager_review` buckets to
 * `final_interview`, which produces no score of its own, so the one group whose
 * title promises a score rendered every row of it blank. And a bucket cannot
 * say which scorer wrote the number, so the resume tier travelled with whatever
 * score was picked — putting an "Eligible" pill, a verdict about somebody's CV,
 * beside a number about their interview.
 *
 * Nothing here sums two stages: each state names the single most recent reading
 * somebody actually produced. That is the opposite of the rollup CLAUDE.md's
 * "Independent Stage Scores" forbids, and `scoreStage` travels with the number
 * so the UI has to say which stage it is showing.
 */
const EVIDENCE_STAGE: Partial<Record<ApplicationState, CandidateScore["stage"]>> = {
  screening_review_pending: "resume",
  screening_scored: "screening",
  interview_scored: "interview",
  // The interview is the last thing anybody read before the handoff; manager
  // review is a person taking ownership and produces no number of its own.
  manager_review: "interview",
};

type Evidence = Pick<DecisionItem, "score" | "scoreStage" | "tier">;

const NO_EVIDENCE: Evidence = { score: null, scoreStage: null, tier: null };

function evidenceFor(row: DecisionRow): Evidence {
  const scoreStage = EVIDENCE_STAGE[row.status];
  if (!scoreStage) return NO_EVIDENCE;

  const score =
    scoreStage === "resume"
      ? row.resumeScore
      : scoreStage === "screening"
        ? row.screeningScore
        : row.interviewScore;

  if (score === null) return NO_EVIDENCE;

  // Only the resume scorer bands its result. `withInterviewScore` makes the
  // same point from the other side: inventing a tier for another stage would
  // put a verdict on screen that no model ever produced.
  return { score, scoreStage, tier: scoreStage === "resume" ? row.resumeTier : null };
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
    ...evidenceFor(row),
    hoursInStage: (now.getTime() - new Date(row.updatedAt).getTime()) / 3_600_000,
    sla: slaApplies ? applicationSlaStatus(stage, row.updatedAt, slaTimers, now) : null,
  };
}

/**
 * How long somebody has been waiting, in the largest unit that is still true.
 *
 * Whole days alone floored a 14-hour wait to "0 days", which reads as "nobody
 * has been waiting" directly under a heading saying somebody has. It shows up
 * on any campaign whose alert threshold is under a day — the default timer's is
 * 36 hours — so it needed only one late candidate on a fresh campaign.
 */
export function describeWait(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) {
    const whole = Math.floor(hours);
    return `${whole} ${whole === 1 ? "hour" : "hours"}`;
  }
  return `${Math.floor(hours / 24)} days`;
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/** "3 people · longest wait 12 days" — the same sentence for every group. */
function summarise(items: DecisionItem[]): string {
  return `${people(items.length)} · longest wait ${describeWait(items[0].hoursInStage)}`;
}

/**
 * Group the queue by what happens if the recruiter does nothing.
 *
 * Lateness is its own group rather than a badge inside the others, because a
 * late approval and a late decision are the same job — "someone has been
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
    else if (AWAITING_DECISION_STATES.includes(item.status)) decide.push(item);
  }

  // Oldest first inside every group: the queue exists to surface the person who
  // has been waiting longest, and any other order hides them below the fold.
  const byAge = (a: DecisionItem, b: DecisionItem) => b.hoursInStage - a.hoursInStage;
  overdue.sort(byAge);
  decide.sort(byAge);
  approve.sort(byAge);
  lapsed.sort(byAge);

  const groups: DecisionGroup[] = [];

  if (overdue.length > 0) {
    groups.push({
      // Not "past SLA": `alert` fires at the campaign's alert threshold, which
      // sits BEFORE its time limit — 36 hours against 48 in the default timer —
      // so a heading announcing a passed deadline was announcing one that had
      // not passed. "Running late" is true at either threshold, under any
      // configuration a recruiter can save.
      key: "overdue",
      title: "Running late",
      subtitle: summarise(overdue),
      items: overdue,
    });
  }
  if (decide.length > 0) {
    groups.push({
      key: "decide",
      title: "Scored · waiting on you",
      subtitle: summarise(decide),
      items: decide,
    });
  }
  if (approve.length > 0) {
    groups.push({
      key: "approve",
      title: "Approve into screening",
      subtitle: summarise(approve),
      items: approve,
    });
  }
  if (lapsed.length > 0) {
    groups.push({
      key: "lapsed",
      title: "Ended without a decision",
      // The load-bearing fact, and the one nothing else on the page says: a
      // lapsed link is not a rejection, so these people are still undecided.
      subtitle: `${people(lapsed.length)} · nobody was rejected`,
      items: lapsed,
    });
  }

  return { groups };
}
