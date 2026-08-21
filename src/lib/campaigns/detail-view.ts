import { formatApplicationState, type ApplicationState } from "@/lib/constants";

/**
 * "3d" — whole days an application has sat where it is.
 *
 * Computed on the server, where the campaign page renders once, so the reading
 * is taken from one clock. Doing it in a client component would give a number
 * that disagreed with the one the server sent.
 */
export function daysInStage(updatedAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(updatedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}h` : "<1h";
}

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
  processing_failed: "CV could not be read",
};

/**
 * What happened, as an event. Exported because the candidate's history reads
 * the same way — "Screening scored" rather than the state name it landed in —
 * and one map is the only way the two stay saying the same thing.
 */
export function eventLabel(status: ApplicationState): string {
  return EVENT_LABEL[status] ?? formatApplicationState(status);
}

export function lastActivityLabel(
  status: ApplicationState,
  updatedAt: string,
  now: Date = new Date(),
): string {
  const event = eventLabel(status);
  const age = relativeAge(updatedAt, now);
  return age ? `${event} · ${age}` : event;
}

/**
 * The stage the campaign page previews when the recruiter has not picked one.
 *
 * The busiest **active** stage, because that is where the work is. Terminal
 * buckets are excluded even when they are the largest — on a mature campaign
 * Rejected always is, and opening on it would show a page of decisions already
 * made. Falls back to `applied` so the section always has a stage to name.
 */
const ACTIVE_STAGES = ["screening", "interview", "final_interview", "applied"] as const;

export function defaultPreviewStage(stageCounts: Record<string, number>): string {
  let best: string | null = null;
  let bestCount = 0;
  for (const key of ACTIVE_STAGES) {
    const count = stageCounts[key] ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best ?? "applied";
}
