import { pipelineDisplayScore } from "@/lib/constants";
import type { Candidate } from "@/lib/constants";

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

function matchesStage(candidate: Candidate, stageFilter: string): boolean {
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

function matchesSearch(candidate: Candidate, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;

  return (
    candidate.name.toLowerCase().includes(q) ||
    candidate.email.toLowerCase().includes(q) ||
    (candidate.current_title ?? "").toLowerCase().includes(q) ||
    (candidate.current_company ?? "").toLowerCase().includes(q)
  );
}

function compare(a: Candidate, b: Candidate, sort: CandidateSortField): number {
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
  candidates: Candidate[],
  view: CandidateTableView,
): Candidate[] {
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
  candidates: Candidate[],
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
