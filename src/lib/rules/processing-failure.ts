import type { ApplicationState } from "@/lib/constants";

/**
 * Which `processing_failed` applications can be recovered by re-reading the CV.
 *
 * `processing_failed` is reachable from three places and they are not the same
 * accident. From `new` it means the resume ingest broke — Marker timed out, a
 * model was down — and nothing about the candidate has been established yet,
 * so re-reading the CV is exactly the repair. From `screening_completed` or
 * `interview_completed` it means a SCORE could not be computed for a candidate
 * who has already been through those stages, and re-reading their CV would
 * repair nothing while dragging them back to `new` — throwing away a screening
 * they actually sat.
 *
 * The state alone cannot tell those apart, which is why this takes the state
 * the application failed FROM. Getting it wrong in the permissive direction
 * destroys real evidence, so the rule is an allowlist of one.
 */
export function isRecoverableProcessingFailure(args: {
  status: ApplicationState;
  /** The state the application was in immediately before it failed. */
  failedFrom: ApplicationState | null;
}): boolean {
  return args.status === "processing_failed" && args.failedFrom === "new";
}

/** The minimum a timeline entry has to carry to answer the question above. */
export interface ProcessingFailureLookup {
  fromState: ApplicationState | null;
  toState: ApplicationState;
  at: string;
}

/**
 * The state an application failed from, read off its history.
 *
 * The most recent entry wins, not the first: an application can fail, be
 * repaired, and fail again, and only the latest failure describes where it
 * stands now. Order-agnostic on purpose — it compares timestamps rather than
 * trusting the caller to have sorted, because a rule that silently depends on
 * a query's ORDER BY is one a later refactor breaks quietly.
 */
export function processingFailureOrigin(
  entries: readonly ProcessingFailureLookup[],
): ApplicationState | null {
  let latest: ProcessingFailureLookup | null = null;

  for (const entry of entries) {
    if (entry.toState !== "processing_failed") continue;
    if (latest === null || entry.at > latest.at) latest = entry;
  }

  return latest?.fromState ?? null;
}
