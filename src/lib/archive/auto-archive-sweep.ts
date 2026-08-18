import { createAdminClient } from "@/lib/supabase/admin";
import { fetchArchivableApplications } from "@/lib/data/candidates";
import {
  archiveDisposition,
  isAutoArchivable,
  shouldAutoArchive,
} from "@/lib/rules/auto-archive";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

export interface ArchiveSweepResult {
  /** Applications in a non-responsive state on an opted-in campaign. */
  scanned: number;
  /** Left alone — still inside their campaign's window. */
  skipped: number;
  /** Moved to `archived`. */
  archived: number;
  /** Failed mid-flight (logged, not thrown). */
  failed: number;
}

/**
 * Move non-responsive candidates out of the active pipeline (PRD 3.12.4).
 *
 * The third sweep, and the one that depends on the other two: it can only act on
 * applications that actually reached `screening_expired` / `interview_expired`,
 * which is what the screening and interview expiry sweeps produce. Until those
 * were scheduled (#131) this would have had almost nothing to find.
 *
 * Archiving is housekeeping rather than a verdict — the outcome was decided when
 * the candidate stopped responding. That is what makes it safe to automate, and
 * it is reversible (`unarchiveApplication`) for the cases where it is wrong.
 *
 * Runs session-less on the admin client; `now` is injectable for testing. One
 * failure is logged and the sweep continues, so a single bad row cannot strand
 * the rest.
 */
export async function sweepAutoArchive(
  now: Date = new Date(),
): Promise<ArchiveSweepResult> {
  const db = createAdminClient();
  const rows = await fetchArchivableApplications(db);

  const due = rows.filter((r) => shouldAutoArchive(r, now));

  let archived = 0;
  let failed = 0;

  for (const row of due) {
    // Narrowed by the rule already; this satisfies the type and documents that
    // the disposition depends on WHICH failure state we are archiving from.
    if (!isAutoArchivable(row.status)) continue;

    try {
      await transitionApplicationAsSystem(
        row.application_id,
        "archived",
        `Non-responsive for ${row.auto_archive_after_days} days in ${row.status}`,
        archiveDisposition(row.status, row.auto_archive_after_days ?? 0),
      );
      archived += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `Auto-archive sweep failed for ${row.application_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    scanned: rows.length,
    skipped: rows.length - due.length,
    archived,
    failed,
  };
}
