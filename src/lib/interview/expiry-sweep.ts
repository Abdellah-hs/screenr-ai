import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchOverdueInterviewSessions,
  markInterviewExpired,
} from "@/lib/data/interview-sessions";
import { isInterviewAbandoned } from "@/lib/rules/interview-expiry";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const SWEEP_RATIONALE =
  "Interview deadline passed without the candidate completing the AI interview (proactive sweep)";

export interface InterviewSweepResult {
  /** How many overdue open interview sessions the sweep found. */
  scanned: number;
  /**
   * How many were left alone because a call could still be running — a session
   * that started shortly before its deadline. Reported rather than silently
   * dropped: a sweep that keeps skipping the same rows is worth noticing.
   */
  skipped: number;
  /** How many were successfully moved to `interview_expired`. */
  expired: number;
  /** How many failed mid-flight (logged, not thrown). */
  failed: number;
}

/**
 * Proactive counterpart to the lazy expiry in `loadInterviewContext` /
 * `startCandidateInterview`: finds every interview invitation still open but
 * past its deadline and moves it to `interview_expired`.
 *
 * The interview was the one stage with neither a happy-path nor a failure-path
 * exit for a no-show — screening has had both since `sweepExpiredScreenings`,
 * while an invited candidate who never appeared sat in `interview_invited`
 * indefinitely, counted as active pipeline that nobody was waiting on.
 *
 * Runs session-less (admin client + system transition); intended to be invoked
 * on a schedule via `/api/cron/expire-interviews`. `now` is injectable so the
 * boundary is testable.
 *
 * Each application is handled independently: a single failure is logged and the
 * sweep continues, so one bad row can't strand the rest. The state-machine
 * guard in `transitionApplicationAsSystem` is the backstop — anything no longer
 * in `interview_invited` (e.g. the candidate submitted seconds ago) is rejected
 * as an illegal transition and counted as a failure, never a corruption.
 */
export async function sweepExpiredInterviews(
  now: Date = new Date(),
): Promise<InterviewSweepResult> {
  const db = createAdminClient();
  const sessions = await fetchOverdueInterviewSessions(now, db);

  // The query selects candidates; the rule decides which have truly lapsed, so
  // a call still in flight when its deadline passed is never swept out from
  // under the candidate.
  const abandoned = sessions.filter((s) => isInterviewAbandoned(s, now));

  let expired = 0;
  let failed = 0;

  for (const { application_id: applicationId } of abandoned) {
    try {
      await transitionApplicationAsSystem(
        applicationId,
        "interview_expired",
        SWEEP_RATIONALE,
        // Same reasoning as the screening sweep: `interview_expired` says why on
        // its own, but recording a disposition anyway keeps sweep closures in
        // the same countable bucket as every other EXPIRED outcome.
        { code: "EXPIRED", description: SWEEP_RATIONALE },
      );
      // Application first, session second: the application state is what the
      // pipeline reads. A failure here leaves a stale session row against a
      // correctly-closed application, which the status guard on the next sweep
      // tidies — the reverse order would strand the application instead.
      await markInterviewExpired(applicationId, db);
      expired += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `Interview expiry sweep failed for ${applicationId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    scanned: sessions.length,
    skipped: sessions.length - abandoned.length,
    expired,
    failed,
  };
}
