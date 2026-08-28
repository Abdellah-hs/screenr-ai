import { pipelineDisplayScore, stageScoreKind } from "@/lib/constants";
import type { CandidateListRow, CandidateScore } from "@/lib/constants";

/**
 * The candidate table's filter + sort, as a pure function.
 *
 * Lifted out of the component so the semantics can be tested. They are not
 * obvious: the pills are coarse pipeline buckets, "Rejected" and "Archived" are
 * disjoint despite sharing a bucket, "Pending review" is a flag rather than a
 * stage, and the overdue narrowing is orthogonal to all of it. Every one of
 * those is a rule someone can get wrong while moving JSX around.
 */

export type CandidateSortField = "name" | "applied_at" | "score" | "stage_age";

export interface CandidateTableView {
  /** Free text over name, email, title and company. */
  search: string;
  /** A pipeline bucket, `all`, `pending_review`, or `archived`. */
  stageFilter: string;
  /** Narrows to SLA-breaching rows, on top of whatever pill is selected. */
  overdueOnly: boolean;
  sort: CandidateSortField;
}

function matchesStage(candidate: CandidateListRow, stageFilter: string): boolean {
  if (stageFilter === "all") return true;
  if (stageFilter === "pending_review") return candidate.awaiting_human_review;
  if (stageFilter === "archived") return candidate.is_archived;
  // Rejected and Archived are disjoint groups — an archived application files
  // under the `rejected` bucket but belongs to its own pill, not this one.
  if (stageFilter === "rejected") {
    return candidate.stage === "rejected" && !candidate.is_archived;
  }
  return candidate.stage === stageFilter;
}

function matchesSearch(candidate: CandidateListRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;

  return (
    candidate.name.toLowerCase().includes(q) ||
    candidate.email.toLowerCase().includes(q) ||
    (candidate.current_title ?? "").toLowerCase().includes(q) ||
    (candidate.current_company ?? "").toLowerCase().includes(q)
  );
}

function compare(a: CandidateListRow, b: CandidateListRow, sort: CandidateSortField): number {
  if (sort === "name") return a.name.localeCompare(b.name);

  if (sort === "score") {
    return (pipelineDisplayScore(b)?.overall ?? 0) - (pipelineDisplayScore(a)?.overall ?? 0);
  }

  if (sort === "stage_age") {
    // Oldest last-activity first. Sorting on the timestamp rather than on
    // `sla.hours` keeps the order total: rows with no breach still sort
    // sensibly among themselves instead of collapsing into a single tie.
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  }

  return new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime();
}

export function selectCandidates(
  candidates: CandidateListRow[],
  view: CandidateTableView,
): CandidateListRow[] {
  return candidates
    .filter(
      (c) =>
        (!view.overdueOnly || c.sla !== null) &&
        matchesStage(c, view.stageFilter) &&
        matchesSearch(c, view.search),
    )
    .sort((a, b) => compare(a, b, view.sort));
}

/**
 * Counts for the funnel cards and the two attention banners.
 *
 * `rejected` has archived rows subtracted out so the two pills stay disjoint
 * and the numbers across the row add up to the total.
 */
export function candidateStageCounts(
  candidates: CandidateListRow[],
): Record<string, number> {
  const counts: Record<string, number> = {
    all: candidates.length,
    pending_review: 0,
    archived: 0,
    overdue: 0,
  };

  for (const c of candidates) {
    counts[c.stage] = (counts[c.stage] || 0) + 1;
    if (c.awaiting_human_review) counts.pending_review += 1;
    if (c.is_archived) counts.archived += 1;
    if (c.sla) counts.overdue += 1;
  }

  counts.rejected = (counts.rejected ?? 0) - counts.archived;
  return counts;
}

/**
 * What the header of the Score column says, once, instead of a tag repeated
 * beside every number in it.
 */
const SCORE_COLUMN_HEADER: Record<CandidateScore["stage"], string> = {
  resume: "Resume score",
  screening: "Screening score",
  interview: "Interview score",
};

export interface CandidateTableColumns {
  /** Draw the Stage column. */
  stage: boolean;
  /** The Score column's header, or null when there should be no column. */
  scoreHeader: string | null;
  /** Draw the per-row "Pending review" flag. */
  pendingFlag: boolean;
}

/**
 * Which columns the candidate table draws under a given filter.
 *
 * One rule behind all three: **a column that says the same thing on every row
 * carries no information.** Filtered to Screening, a Stage column is the word
 * "Screening" repeated down the page, and a tag beside each score saying the
 * number came from screening is the same restatement once per row. The filter
 * pill and the "N of M · Screening" summary already say it, once.
 *
 * The Score column has a second reason to disappear. `pipelineDisplayScore`
 * only ever returns a number for a bucket that holds a sitting of its own, so
 * under Final Interview, Hired or Rejected every cell would render a named
 * absence — a column-wide restatement of the filter, taking the width of a
 * real number. `stageScoreKind` is the same map the selector reads, so the
 * column exists exactly when a number could appear in it.
 *
 * Pure, and separate from the component, because each line is a judgement call
 * someone can quietly get wrong while moving JSX around.
 */
export function candidateTableColumns(stageFilter: string): CandidateTableColumns {
  // "Awaiting review" is a flag rather than a pill, but it can only be raised
  // in `screening_review_pending`, which buckets as Applied — so those rows do
  // all share a stage, and it is one that scores. `archived` is the opposite:
  // archiving is reachable from anywhere, so that list spans the pipeline and
  // `stageScoreKind` rightly answers null for it.
  const kind = stageScoreKind(
    stageFilter === "pending_review" ? "applied" : stageFilter,
  );

  return {
    stage: stageFilter === "all",
    scoreHeader: kind === null ? null : SCORE_COLUMN_HEADER[kind],
    pendingFlag: stageFilter !== "pending_review",
  };
}
