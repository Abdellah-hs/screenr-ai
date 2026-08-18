import { INTERVIEW_DURATION_MINUTES } from "@/lib/constants";

/**
 * Pure decision: has an open interview invitation lapsed for good?
 *
 * The sweep can't simply close everything past its deadline. An invitation that
 * was never opened is unambiguous, but a session already `in_progress` may be a
 * candidate mid-answer whose 7-day deadline happened to fall during their call —
 * expiring that one destroys a real interview and its transcript. So a started
 * session is only abandoned once enough time has passed that the call cannot
 * still be running.
 *
 * Reads evidence, returns a decision. No I/O, no transition — the sweep executes.
 */

/**
 * Slack on top of the call length before a started-but-unsubmitted session
 * counts as abandoned. Covers a slow finish, a reconnect, and a submit that
 * arrives late — all cheaper to wait out than to wrongly close a real interview.
 */
export const ABANDONED_GRACE_MINUTES = 15;

const ABANDONED_AFTER_MS =
  (INTERVIEW_DURATION_MINUTES + ABANDONED_GRACE_MINUTES) * 60 * 1000;

export interface OpenInterviewSession {
  status: "invited" | "in_progress";
  /** ISO deadline; null means no deadline was ever set. */
  expires_at: string | null;
  /** ISO time the candidate opened the room, if they ever did. */
  started_at: string | null;
}

export function isInterviewAbandoned(
  session: OpenInterviewSession,
  now: Date = new Date(),
): boolean {
  // No deadline means nothing to be past. Guessing one would close a live
  // invitation that nobody ever gave a date.
  if (!session.expires_at) return false;

  const deadline = Date.parse(session.expires_at);
  if (Number.isNaN(deadline) || now.getTime() <= deadline) return false;

  // Never opened the room: the deadline is the whole story.
  if (session.status === "invited") return true;

  // Started, never submitted. A missing `started_at` on an in-progress row is a
  // stale record, not a live call — nothing is running that we can protect.
  if (!session.started_at) return true;

  const startedAt = Date.parse(session.started_at);
  if (Number.isNaN(startedAt)) return true;

  return now.getTime() - startedAt > ABANDONED_AFTER_MS;
}
