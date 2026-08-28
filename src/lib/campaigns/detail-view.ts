/**
 * The two jobs a campaign page does, split so each fits a screen.
 *
 * **Pipeline** is the daily work — who is where, what is late, what happened.
 * **Setup** is what was decided once at creation and is rarely touched — the
 * rubric, the questions, the apply link, the social post. They were stacked in
 * one column, which made the page long enough that the daily half sat above a
 * fold of configuration nobody was reading that day.
 *
 * The tab lives in the URL rather than in client state, so the page stays a
 * Server Component, a link can point at a specific tab (the empty-questions
 * banner does), and Back works.
 */
export const CAMPAIGN_DETAIL_TABS = [
  { key: "pipeline", label: "Pipeline" },
  { key: "setup", label: "Setup" },
] as const;

export type CampaignDetailTab = (typeof CAMPAIGN_DETAIL_TABS)[number]["key"];

/**
 * Anything that is not a known tab falls back to Pipeline — a hand-edited or
 * stale `?tab=` must not render an empty page.
 */
export function resolveDetailTab(requested: string | undefined): CampaignDetailTab {
  const match = CAMPAIGN_DETAIL_TABS.find((t) => t.key === requested);
  return match ? match.key : "pipeline";
}

import { formatApplicationState, type ApplicationState } from "@/lib/constants";

/** "2h ago" / "3d ago" — the age half of a last-activity line. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * "Screening scored · 2h ago" — what last happened to an application and when.
 *
 * The state is phrased as an event rather than a status, because the column is
 * answering "has anything moved?" and a bare state name answers "where is it?",
 * which the Stage column already said.
 */
const EVENT_LABEL: Partial<Record<ApplicationState, string>> = {
  new: "Application received",
  screening_review_pending: "CV scored, waiting for approval",
  screening_approved: "Approved into screening",
  screening_sent: "Link sent",
  screening_completed: "Call completed",
  screening_scored: "Screening scored",
  screening_expired: "Link expired unused",
  interview_invited: "Interview invite sent",
  interview_completed: "Interview completed",
  interview_scored: "Interview scored",
  interview_expired: "Interview window closed",
  interview_no_show: "Interview window closed",
  reference_check: "Reference check started",
  manager_review: "Sent to manager review",
  final_interview_scheduling: "Final round offered",
  hired: "Hired",
  rejected: "Rejected",
  archived: "Archived",
  // Not "CV could not be read": this state is reached when OUR side failed —
  // an extractor timeout, a model outage, a screening or interview score that
  // could not be computed. Naming the candidate's file as the culprit is the
  // same lie the ingest path used to tell them by email.
  processing_failed: "Processing failed",
};

/**
 * What happened, as an event. Exported because the candidate's history reads
 * the same way — "Screening scored" rather than the state name it landed in —
 * and one map is the only way the two stay saying the same thing.
 */
export function eventLabel(status: ApplicationState): string {
  return EVENT_LABEL[status] ?? formatApplicationState(status);
}
