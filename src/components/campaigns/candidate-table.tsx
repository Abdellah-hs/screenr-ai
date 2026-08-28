"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { pipelineDisplayScore } from "@/lib/constants";
import {
  candidateStageCounts,
  candidateTableColumns,
  selectCandidates,
  type CandidateSortField,
} from "@/lib/candidates/table-view";
import { CandidateBulkActions } from "./candidate-bulk-actions";
import { StageChanger } from "@/components/candidates/stage-changer";
import { MENU_ITEM, ScoreAbsent, ScoreInline } from "@/components/ui";
import { scoreAbsenceLabel } from "@/lib/candidates/score-absence";
import type { CandidateListRow, CandidateStage, SlaBreachLevel } from "@/lib/constants";
import {
  ALL_FUNNEL_STAGE,
  FUNNEL_STAGES,
  ARCHIVED_FUNNEL_STAGE,
  FunnelCard,
} from "./pipeline-funnel";

const stageColors: Record<CandidateStage, string> = {
  applied: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  screening: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
  interview: "text-[#7C3AED] bg-[#F5F3FF] border-[#DDD6FE]",
  final_interview: "text-[#D97706] bg-[#FEF3C7] border-[#FDE68A]",
  hired: "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]",
  rejected: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

/**
 * Past this many rows the table gets its own scroll region so the header can
 * stick. Below it, the page scrolls as it always did.
 *
 * `position: sticky` needs a scrolling ancestor, and the horizontal-scroll
 * wrapper is already one (a non-visible overflow on either axis makes the other
 * `auto`), but it has no height, so nothing ever sticks. Constraining the
 * height is what makes the header real. Doing it unconditionally would put an
 * inner scrollbar on a campaign with four candidates, which is worse than no
 * sticky header at all — hence the threshold.
 */
const STICKY_HEADER_MIN_ROWS = 12;

const stageLabels: Record<CandidateStage, string> = {
  applied: "New",
  screening: "Screening",
  interview: "Interview",
  final_interview: "Final Interview",
  hired: "Hired",
  rejected: "Rejected",
};

type SortField = CandidateSortField;

/**
 * The overdue badge, styled by how far past the SLA the application is.
 *
 * Amber for an alert, red for an escalation — the same two-tone split the
 * notification bell uses, so a recruiter who saw red in the bell finds red in
 * the row rather than having to re-read the severity.
 */
const slaBadgeStyles: Record<SlaBreachLevel, string> = {
  alert: "text-[#B45309] bg-[#FFFBEB] border-[#FDE68A]",
  escalation: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

export default function CandidateTable({
  candidates,
  campaignId,
  initialFilter = "all",
  initialOverdue = false,
}: {
  candidates: CandidateListRow[];
  campaignId: string;
  /** Seeds the stage pill selection, e.g. from a `?stage=` deep link. */
  initialFilter?: string;
  /** Seeds the overdue narrowing, from the bell's `?overdue=1` deep link. */
  initialOverdue?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>(initialFilter);
  // Orthogonal to the stage pills rather than a pill of its own: an SLA breach
  // is a property of an application *within* a stage, and the bell counts them
  // per stage. Making it a pill would force "overdue in screening" to be
  // expressed as two mutually exclusive selections.
  const [overdueOnly, setOverdueOnly] = useState(initialOverdue);
  const [sortBy, setSortBy] = useState<SortField>(
    // Arriving from the bell, the useful order is worst-first.
    initialOverdue ? "stage_age" : "applied_at",
  );
  // Ids rather than indices, so a selection survives filtering and sorting —
  // a recruiter who ticks four people, changes the filter, and comes back has
  // not lost them.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const stageCounts = useMemo(() => candidateStageCounts(candidates), [candidates]);

  // The "Pending review" banner (and its filter) only exist while candidates
  // are actually awaiting review. Once the queue empties the banner disappears,
  // so a stale "pending_review" filter intent must fall back to "all" (handled
  // in effectiveFilter below) to avoid stranding the user on a hidden state.
  const pendingCount = stageCounts.pending_review ?? 0;
  const showPendingReview = pendingCount > 0;

  // Counted across the whole campaign, not the current pill, so the number here
  // matches the one in the notification bell.
  const overdueCount = stageCounts.overdue ?? 0;
  const showOverdue = overdueCount > 0;
  // A campaign with no SLA timers, or one whose breaches have all been
  // resolved, must not strand the user on an empty filtered list.
  const overdueActive = overdueOnly && showOverdue;
  // Only surface the Archived group when there's something in it, so the pill
  // row stays quiet for campaigns that never archive anyone.
  const showArchived = stageCounts.archived > 0;
  const effectiveFilter = (() => {
    if (stageFilter === "pending_review" && !showPendingReview) return "all";
    if (stageFilter === "archived" && !showArchived) return "all";
    return stageFilter;
  })();

  // Which columns are worth drawing under this filter — see
  // `candidateTableColumns`. The short version: once every visible row shares a
  // stage, the Stage column and a per-score stage tag both just repeat the
  // filter, and a stage that produces no score of its own needs no Score
  // column at all.
  const columns = candidateTableColumns(effectiveFilter);
  const showScore = columns.scoreHeader !== null;
  const effectiveSort: SortField = (() => {
    if (!showScore && sortBy === "score") return "applied_at";
    // "Longest in stage" is only offered where an SLA exists to make it mean
    // something; falling back keeps a stale selection from silently reordering.
    if (!showOverdue && sortBy === "stage_age") return "applied_at";
    return sortBy;
  })();

  // Funnel cards: an "All" reset card, the forward stages, then the terminal
  // Archived bucket (only when it has anyone).
  const stageCards = showArchived
    ? [...FUNNEL_STAGES, ARCHIVED_FUNNEL_STAGE]
    : FUNNEL_STAGES;
  const funnelStages = [ALL_FUNNEL_STAGE, ...stageCards];

  const filtered = useMemo(
    () =>
      selectCandidates(candidates, {
        search,
        stageFilter: effectiveFilter,
        overdueOnly: overdueActive,
        sort: effectiveSort,
      }),
    [candidates, search, effectiveFilter, effectiveSort, overdueActive],
  );

  // Select-all applies to the current filter, not the whole campaign — the
  // header checkbox must promise exactly what the rows underneath it show.
  const visibleIds = filtered.map((c) => c.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  // Resolved against the full list, not the filtered one: a selection made
  // before the filter changed is still a selection, and dropping it silently
  // would act on fewer people than the toolbar's count promises.
  const selectedCandidates = candidates.filter((c) => selectedIds.has(c.id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Whether the view is narrowed at all — decides which empty state to show.
  // `overdueActive`, not `overdueOnly`: a stale overdue intent on a campaign
  // with no breaches narrows nothing, so it must not claim to.
  const hasNarrowedView =
    search.trim() !== "" || effectiveFilter !== "all" || overdueActive;

  function clearFilters() {
    setSearch("");
    setStageFilter("all");
    setOverdueOnly(false);
  }

  const stickyHeader = filtered.length >= STICKY_HEADER_MIN_ROWS;

  // Named in the same words the controls use, so a recruiter can undo the one
  // they did not mean to set.
  const narrowings = [
    search.trim() ? `search “${search.trim()}”` : null,
    effectiveFilter === "all"
      ? null
      : effectiveFilter === "pending_review"
        ? "awaiting review"
        : effectiveFilter === "archived"
          ? "archived"
          : stageLabels[effectiveFilter as CandidateStage],
    overdueActive ? "past SLA" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      {/* Pipeline funnel — doubles as the stage filter. Click a card to filter,
          click it again to clear. */}
      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:[grid-template-columns:repeat(var(--funnel-cols),minmax(0,1fr))]"
        style={{ "--funnel-cols": funnelStages.length } as CSSProperties}
      >
        {funnelStages.map((stage) => {
          const isAll = stage.key === "all";
          const count = stageCounts[stage.key] ?? 0;
          const isActive = effectiveFilter === stage.key;
          return (
            <FunnelCard
              key={stage.key}
              stage={stage}
              count={count}
              active={isActive}
              onClick={() =>
                setStageFilter(isActive && !isAll ? "all" : stage.key)
              }
            />
          );
        })}
      </div>

      {/* Pending review — an attention banner that doubles as a filter. Shown
          only while candidates are actually awaiting review; click to filter the
          list down to them, click again to clear. */}
      {showPendingReview && (
        <button
          type="button"
          onClick={() =>
            setStageFilter(
              effectiveFilter === "pending_review" ? "all" : "pending_review",
            )
          }
          aria-pressed={effectiveFilter === "pending_review"}
          className={`flex w-full items-center justify-between gap-3 rounded-lg border border-[#FDE68A] px-4 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-1 ${
            effectiveFilter === "pending_review"
              ? "bg-[#FEF3C7]"
              : "bg-[#FFFBEB] hover:bg-[#FEF3C7]"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-[#92400E]">
            <span className="h-2 w-2 rounded-full bg-[#F59E0B]" aria-hidden="true" />
            {pendingCount} candidate{pendingCount === 1 ? "" : "s"} awaiting your
            review
          </span>
          <span className="text-xs font-medium text-[#B45309]">
            {effectiveFilter === "pending_review" ? "Clear filter" : "View →"}
          </span>
        </button>
      )}

      {/* Overdue — the SLA counterpart to the pending-review banner. Narrows
          the list to breaching applications on top of whatever stage pill is
          selected, so "overdue in Screening" is one click plus one pill. */}
      {showOverdue && (
        <button
          type="button"
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueActive}
          className={`flex w-full items-center justify-between gap-3 rounded-lg border border-[#FECACA] px-4 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-1 ${
            overdueActive ? "bg-[#FEE2E2]" : "bg-[#FEF2F2] hover:bg-[#FEE2E2]"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-[#991B1B]">
            <svg
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {overdueCount} candidate{overdueCount === 1 ? " is" : "s are"} past
            the stage SLA
          </span>
          <span className="text-xs font-medium text-[#B91C1C]">
            {overdueActive ? "Clear filter" : "View →"}
          </span>
        </button>
      )}

      {selectedCandidates.length > 0 && (
        <CandidateBulkActions
          selected={selectedCandidates}
          onDone={() => setSelectedIds(new Set())}
        />
      )}

      {/* Search + Sort */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name, email, title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search candidates"
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#D1D5DB] rounded-lg text-sm text-ink placeholder-[#9CA3AF] transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20 outline-none"
          />
        </div>

        <select
          value={effectiveSort}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          aria-label="Sort candidates"
          className="bg-white border border-[#D1D5DB] text-ink text-sm rounded-lg px-3 py-2 cursor-pointer transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20 outline-none w-full sm:w-auto"
        >
          <option value="applied_at">Sort by Newest</option>
          <option value="name">Sort A-Z</option>
          {showScore && <option value="score">Sort by Score</option>}
          {showOverdue && (
            <option value="stage_age">Sort by Longest in stage</option>
          )}
        </select>

        {/* What the list currently is, spelled out. Three narrowings can be
            active at once (search, a stage pill, the overdue toggle) and only
            one of them is visible from the table itself. */}
        <p className="text-sm text-[#6B7280] sm:ml-auto">
          <span className="font-semibold tabular-nums text-ink">
            {filtered.length}
          </span>{" "}
          of {candidates.length}
          {narrowings.length > 0 && ` · ${narrowings.join(", ")}`}
        </p>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 px-6 bg-white border border-[#E5E7EB] rounded-xl flex flex-col justify-center items-center">
          <div className="w-16 h-16 bg-[#F3F4F6] text-[#9CA3AF] rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
              />
            </svg>
          </div>
          {/* "Nobody has applied" and "your filters match nobody" are different
              facts with different next actions, and showing one message for
              both let an over-narrow filter read as an empty campaign. */}
          {hasNarrowedView ? (
            <>
              <p className="font-medium text-ink">No candidates match these filters</p>
              <p className="mt-1 text-sm text-[#6B7280]">
                {candidates.length} {candidates.length === 1 ? "person is" : "people are"} in
                this campaign.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 px-4 py-2 text-sm font-semibold text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="font-medium text-ink">No one has applied yet</p>
              <p className="mt-1 max-w-sm text-sm text-[#6B7280]">
                Share this campaign&apos;s apply link and applications will land here
                automatically, parsed and scored.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
          <div className={stickyHeader ? "overflow-auto max-h-[calc(100vh-14rem)]" : "overflow-x-auto"}>
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead
                className={`bg-[#F9FAFB] text-xs font-semibold text-[#6B7280] uppercase tracking-wider ${
                  stickyHeader
                    ? // A sticky <thead> loses its own border in most engines
                      // (the row scrolls under it and the 1px border is painted
                      // per-cell), so the edge is drawn with a shadow instead.
                      "sticky top-0 z-10 shadow-[inset_0_-1px_0_#E5E7EB]"
                    : "border-b border-[#E5E7EB]"
                }`}
              >
                <tr>
                  <th scope="col" className="w-10 pl-6 pr-0 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      // Indeterminate is the honest state for a partial
                      // selection: an unchecked box next to four ticked rows
                      // reads as "nothing selected".
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      aria-label={
                        allVisibleSelected
                          ? "Deselect all shown candidates"
                          : "Select all shown candidates"
                      }
                      className="h-4 w-4 cursor-pointer accent-[#2563EB]"
                    />
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Candidate
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Title / Company
                  </th>
                  {columns.stage && (
                    <th scope="col" className="px-6 py-3">
                      Stage
                    </th>
                  )}
                  {/* The same boolean the body cell reads, so the header and
                      the rows can never disagree on the column count. */}
                  {showScore && (
                    <th scope="col" className="px-6 py-3">
                      {/* Named here rather than tagged onto every number: the
                          whole column comes from one stage, so it is one fact
                          about the column, not a fact about each row. */}
                      {columns.scoreHeader}
                    </th>
                  )}
                  <th scope="col" className="px-6 py-3">
                    Applied
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Last activity
                  </th>
                  <th scope="col" className="w-14 px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((candidate) => {
                  const stageScore = showScore ? pipelineDisplayScore(candidate) : null;
                  // Under the "awaiting review" filter the flag is the filter:
                  // every row carries it, so it says nothing.
                  const showPendingFlag =
                    columns.pendingFlag && candidate.awaiting_human_review;
                  return (
                    <tr
                      key={candidate.id}
                      className={`transition-colors group ${
                        selectedIds.has(candidate.id)
                          ? "bg-[#EFF6FF] hover:bg-[#DBEAFE]"
                          : "hover:bg-[#F9FAFB]"
                      }`}
                    >
                      <td className="w-10 pl-6 pr-0 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(candidate.id)}
                          onChange={() => toggleRow(candidate.id)}
                          aria-label={`Select ${candidate.name}`}
                          className="h-4 w-4 cursor-pointer accent-[#2563EB]"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <Link
                          href={`/campaigns/${campaignId}/candidates/${candidate.id}`}
                          className="block"
                        >
                          <p className="font-medium text-[#111827] group-hover:text-[#2563EB] transition-colors">
                            {candidate.name}
                          </p>
                          <p className="text-xs text-[#6B7280]">
                            {candidate.email}
                          </p>
                        </Link>

                        {/* The attention flags live on the person, not in the
                            Stage column. They used to share that cell, which
                            meant hiding a redundant Stage column would have
                            taken an SLA breach down with it — and a breach is
                            the one thing in a row that must never vanish
                            because of a filter. Outside the Link so the badges
                            are not part of its hit area. */}
                        {(showPendingFlag || candidate.sla) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {showPendingFlag && (
                              <span className="inline-flex px-2 py-0.5 text-[10px] font-medium border rounded-md text-[#B45309] bg-[#FFFBEB] border-[#FDE68A]">
                                Pending review
                              </span>
                            )}
                            {candidate.sla && (
                              <span
                                title={`${candidate.sla.hours} hours in this stage — past the ${
                                  candidate.sla.level === "escalation"
                                    ? "escalation"
                                    : "alert"
                                } threshold`}
                                className={`inline-flex px-2 py-0.5 text-[10px] font-medium border rounded-md ${
                                  slaBadgeStyles[candidate.sla.level]
                                }`}
                              >
                                {/* The word, not just the colour — colour alone
                                    is not an indicator. */}
                                {candidate.sla.level === "escalation"
                                  ? "Overdue · escalated"
                                  : "Overdue"}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3 text-[#4B5563]">
                        {candidate.current_title && candidate.current_company
                          ? `${candidate.current_title} at ${candidate.current_company}`
                          : candidate.current_title ||
                            candidate.current_company ||
                            "—"}
                      </td>
                      {columns.stage && (
                        <td className="px-6 py-3">
                          {candidate.is_archived ? (
                            <span className="inline-flex px-2.5 py-1 text-xs font-medium border rounded-md text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]">
                              Archived
                            </span>
                          ) : (
                            <span
                              className={`inline-flex px-2.5 py-1 text-xs font-medium border rounded-md capitalize ${
                                stageColors[candidate.stage]
                              }`}
                            >
                              {stageLabels[candidate.stage]}
                            </span>
                          )}
                        </td>
                      )}
                      {showScore && (
                        <td className="px-6 py-3">
                          {stageScore ? (
                            <ScoreInline
                              score={stageScore.overall}
                              tier={stageScore.tier}
                            />
                          ) : (
                            /* Never a dash and never a bare "not scored": the
                               reason a row has no number is a fact about the
                               application, and each reason needs a different
                               person to do a different thing. */
                            <ScoreAbsent>
                              {scoreAbsenceLabel(candidate.status)}
                            </ScoreAbsent>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-3 text-[#4B5563] tabular-nums">
                        {new Date(candidate.applied_at).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </td>
                      {/* An absolute date, not "3d ago": a relative label
                          computed after hydration disagrees with the one the
                          server rendered. */}
                      <td className="px-6 py-3 text-[#4B5563] tabular-nums">
                        {new Date(candidate.updated_at).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" }
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {/* The chevron here was decoration — it went where the
                            row already went. The menu is the row's actions,
                            portalled so the table's scroll cannot clip it. */}
                        <StageChanger
                          applicationId={candidate.id}
                          currentState={candidate.status}
                          trigger="menu"
                          leadingItems={
                            <Link
                              href={`/campaigns/${campaignId}/candidates/${candidate.id}`}
                              role="menuitem"
                              className={MENU_ITEM}
                            >
                              Open the evidence file
                            </Link>
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
