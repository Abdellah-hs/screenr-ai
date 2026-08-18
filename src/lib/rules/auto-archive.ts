import { APPLICATION_STATE_TRANSITIONS } from "@/lib/constants";
import type { ApplicationState, Disposition } from "@/lib/constants";

/**
 * Pure decision: has a non-responsive application sat in a failure state long
 * enough to leave the active pipeline? (PRD 3.12.4)
 *
 * Archiving is housekeeping, not a verdict — the outcome was already decided
 * when the candidate stopped responding and the application reached a failure
 * state. This only decides *when* it stops cluttering the recruiter's view, and
 * it is reversible, which is why it can be automatic at all.
 *
 * Reads evidence, returns a decision. No I/O — the sweep executes.
 */

/**
 * States the sweep may archive: the explicit non-responsive dead-ends.
 *
 * `rejected` and `hired` can also be archived (the state map permits it) but are
 * deliberately NOT swept. Those are decided outcomes someone chose, and a real
 * decision should leave the pipeline when a person says so, not on a timer.
 */
export const AUTO_ARCHIVABLE_STATES = [
  "screening_expired",
  "interview_expired",
  "interview_no_show",
  "processing_failed",
] as const;

export type AutoArchivableState = (typeof AUTO_ARCHIVABLE_STATES)[number];

export function isAutoArchivable(state: string): state is AutoArchivableState {
  return (AUTO_ARCHIVABLE_STATES as readonly string[]).includes(state);
}

export interface ArchiveCandidate {
  status: string;
  /** ISO time the application last changed — when it entered this state. */
  entered_at: string | null;
  /** Campaign window in days; null disables auto-archiving. */
  auto_archive_after_days: number | null;
}

/**
 * True when the application should be archived now.
 *
 * A null window means the campaign never opted in, and a null/unparseable
 * timestamp means we cannot tell how long it has waited — both resolve to "leave
 * it alone". Archiving on a guess would hide a candidate the recruiter is still
 * working, and the cost of waiting another day is nothing.
 */
export function shouldAutoArchive(
  candidate: ArchiveCandidate,
  now: Date = new Date(),
): boolean {
  if (candidate.auto_archive_after_days === null) return false;
  if (candidate.auto_archive_after_days <= 0) return false;
  if (!isAutoArchivable(candidate.status)) return false;
  if (!candidate.entered_at) return false;

  const enteredAt = Date.parse(candidate.entered_at);
  if (Number.isNaN(enteredAt)) return false;

  const windowMs = candidate.auto_archive_after_days * 24 * 60 * 60 * 1000;
  return now.getTime() - enteredAt >= windowMs;
}

/**
 * Disposition for an auto-archive, carrying forward WHY the candidate stopped
 * being active. `archived` requires a disposition (DISPOSITION_REQUIRED_STATES),
 * and "archived after 30 days" alone would lose the distinction between someone
 * who never opened their screening link and someone who no-showed an interview.
 */
export function archiveDisposition(
  state: AutoArchivableState,
  windowDays: number,
): Disposition {
  const code = state === "interview_no_show" ? "NO_SHOW" : "EXPIRED";
  return {
    code,
    description: `Auto-archived after ${windowDays} day${windowDays === 1 ? "" : "s"} in ${state}`,
  };
}

/**
 * The state an un-archive should restore, given the archive transition's origin.
 *
 * Returns null when the origin is missing or is not a legal exit from
 * `archived` — the caller must refuse rather than guess. Restoring to a
 * plausible-looking state the application never actually held would put a
 * candidate back into a stage they never reached, and the transitions log would
 * show it as though they had.
 */
export function resolveRestoreTarget(fromState: string | null): ApplicationState | null {
  if (!fromState) return null;

  const legalExits: readonly ApplicationState[] = APPLICATION_STATE_TRANSITIONS.archived;
  return legalExits.includes(fromState as ApplicationState)
    ? (fromState as ApplicationState)
    : null;
}
