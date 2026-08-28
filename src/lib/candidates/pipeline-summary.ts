import { toCandidateStage } from "@/lib/constants";
import { applicationSlaStatus } from "@/lib/rules/sla";
import type { ApplicationState, CandidateStage, SlaTimer } from "@/lib/constants";

/**
 * A candidate application reduced to the fields the campaign board actually
 * counts. Deliberately tiny: no parsed CV, no resume evaluation, no name.
 *
 * The campaign detail page used to answer these six questions by loading every
 * candidate in full — each row carrying its parsed CV and the whole
 * evidence-based resume evaluation, verbatim quotes and all — and then reading
 * six fields off them. On a campaign with a hundred applicants that is a large
 * amount of JSON pulled out of Postgres, parsed, and thrown away.
 */
export interface PipelineRow {
  status: ApplicationState;
  created_at: string;
  updated_at: string;
  /** The "has this CV been evaluated" marker — not `resume_score`, which is
   *  null by design for a candidate who failed a must-have. */
  scored_at: string | null;
  resume_score: number | null;
  rubric_version: number | null;
  screening: {
    status: string | null;
    overall_score: number | null;
    rubric_version: number | null;
  } | null;
}

export interface PipelineSummary {
  total: number;
  /** Applications per coarse pipeline bucket, for the funnel. */
  stageCounts: Record<string, number>;
  /** SLA breaches per bucket — the same `sla` the candidate table badges. */
  breachesByStage: Record<string, number>;
  overdueTotal: number;
  /** Candidates whose visible score predates the campaign's current rubric. */
  staleScoreCount: number;
  /** Applications received inside `RECENT_APPLICATION_WINDOW_MS`. */
  recentApplications: number;
}

export const RECENT_APPLICATION_WINDOW_MS = 7 * 86_400_000;

/**
 * Whether a resume score exists to be shown for this application.
 *
 * `scored_at` is the marker rather than `resume_score`: an ineligible candidate
 * has no ranking score by design, and gating on the number would hide their
 * evaluation entirely. Shared with the candidates list's score builder so the
 * board and the table can never disagree about who has been scored.
 */
export function hasResumeScore(
  row: Pick<PipelineRow, "scored_at" | "resume_score">,
): boolean {
  return row.scored_at != null || row.resume_score != null;
}

/**
 * Whether the screening response has reached a score worth showing.
 *
 * A type predicate so callers that go on to READ the number do not have to
 * restate the condition to convince the compiler — restating it is how the two
 * halves drift apart.
 */
export function hasScreeningScore<
  T extends { status: string | null; overall_score: number | null },
>(screening: T | null): screening is T & { overall_score: number } {
  return screening?.status === "scored" && screening.overall_score != null;
}

/**
 * A score is stale when it was produced against a different rubric version than
 * the one now active. Both versions must be known: a null on either side means
 * "not tracked", which is not the same claim as "out of date" and must never be
 * badged as one.
 */
export function isStaleScore(
  scoredAgainst: number | null,
  currentlyActive: number | null,
): boolean {
  return (
    scoredAgainst != null && currentlyActive != null && scoredAgainst !== currentlyActive
  );
}

/**
 * Everything the campaign board reports about its pipeline, in one pass.
 *
 * Pure, and takes its clock as an argument: one reading for the whole page, so
 * two applications that entered a stage at the same moment can never disagree
 * about whether they are overdue.
 */
export function summarisePipeline(
  rows: PipelineRow[],
  options: {
    slaTimers: SlaTimer[];
    resumeRubricVersion: number | null;
    screeningRubricVersion: number | null;
    now: Date;
  },
): PipelineSummary {
  const { slaTimers, resumeRubricVersion, screeningRubricVersion, now } = options;

  const stageCounts: Record<string, number> = {};
  const breachesByStage: Record<string, number> = {};
  let overdueTotal = 0;
  let staleScoreCount = 0;
  let recentApplications = 0;

  const nowMs = now.getTime();

  for (const row of rows) {
    const stage: CandidateStage = toCandidateStage(row.status);
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;

    if (applicationSlaStatus(stage, row.updated_at, slaTimers, now)) {
      breachesByStage[stage] = (breachesByStage[stage] ?? 0) + 1;
      overdueTotal += 1;
    }

    // "Some visible score is stale" — the same `.some()` the page ran over the
    // built score array, without building one.
    const stale =
      (hasResumeScore(row) && isStaleScore(row.rubric_version, resumeRubricVersion)) ||
      (hasScreeningScore(row.screening) &&
        isStaleScore(row.screening?.rubric_version ?? null, screeningRubricVersion));
    if (stale) staleScoreCount += 1;

    const appliedMs = new Date(row.created_at).getTime();
    if (!Number.isNaN(appliedMs) && nowMs - appliedMs <= RECENT_APPLICATION_WINDOW_MS) {
      recentApplications += 1;
    }
  }

  return {
    total: rows.length,
    stageCounts,
    breachesByStage,
    overdueTotal,
    staleScoreCount,
    recentApplications,
  };
}
