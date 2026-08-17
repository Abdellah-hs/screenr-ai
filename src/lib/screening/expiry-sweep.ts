import {
  fetchExpiredSentScreeningAppIds,
  markScreeningResponseExpiredAsSystem,
} from "@/lib/data/screening-questions";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const SWEEP_RATIONALE =
  "Screening deadline passed without the candidate completing the call (proactive sweep)";

export interface ScreeningSweepResult {
  /** How many overdue `screening_sent` responses the sweep found. */
  scanned: number;
  /** How many were successfully moved to `screening_expired`. */
  expired: number;
  /** How many failed mid-flight (logged, not thrown). */
  failed: number;
}

/**
 * Proactive counterpart to the lazy expiry in `startCandidateVoiceScreening`:
 * finds every screening link that is still `sent` but past its deadline and
 * moves it to `screening_expired` — so the pipeline reflects reality without
 * waiting for the candidate to reopen a dead link.
 *
 * Runs session-less (admin client + system transition); intended to be invoked
 * on a schedule via `/api/cron/expire-screenings`. `now` is injectable so the
 * boundary is testable.
 *
 * Each application is handled independently: a single failure is logged and the
 * sweep continues, so one bad row can't strand the rest. The state-machine
 * guard in `transitionApplicationAsSystem` is the backstop — anything no longer
 * in `screening_sent` (e.g. the candidate just finished) is rejected as an
 * illegal transition and counted as a skip, never a corruption.
 */
export async function sweepExpiredScreenings(
  now: Date = new Date()
): Promise<ScreeningSweepResult> {
  const appIds = await fetchExpiredSentScreeningAppIds(now);

  let expired = 0;
  let failed = 0;

  for (const applicationId of appIds) {
    try {
      await transitionApplicationAsSystem(
        applicationId,
        "screening_expired",
        SWEEP_RATIONALE,
        // `screening_expired` doesn't demand a disposition — the state says
        // why on its own — but recording one anyway puts sweep closures in
        // the same countable bucket as every other EXPIRED outcome, instead
        // of making them the one cause you have to go and count differently.
        { code: "EXPIRED", description: SWEEP_RATIONALE }
      );
      await markScreeningResponseExpiredAsSystem(applicationId);
      expired += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `Screening expiry sweep failed for ${applicationId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { scanned: appIds.length, expired, failed };
}
