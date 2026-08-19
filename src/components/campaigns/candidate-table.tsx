"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { pipelineDisplayScore, TIER_LABELS } from "@/lib/constants";
import {
  candidateStageCounts,
  selectCandidates,
  type CandidateSortField,
} from "@/lib/candidates/table-view";
import { CandidateBulkActions } from "./candidate-bulk-actions";
import type {
  Candidate,
  CandidateScore,
  CandidateStage,
  SlaBreachLevel,
} from "@/lib/constants";
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

const tierColors: Record<string, string> = {
  strong: "text-[#059669] bg-[#ECFDF5]",
  moderate: "text-[#D97706] bg-[#FEF3C7]",
  weak: "text-[#DC2626] bg-[#FEF2F2]",
  no_match: "text-[#B91C1C] bg-[#FEE2E2]",
};

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

// Short tags shown next to the score so a number is never mistaken for a stage
// it didn't come from (the pipeline used to always show the resume score). The
// stage-selection logic lives in pipelineDisplayScore (constants.ts).
const scoreStageTag: Record<CandidateScore["stage"], string> = {
  resume: "Resume",
  screening: "Screening",
  interview: "Interview",
};

export default function CandidateTable({
  candidates,
  campaignId,
  initialFilter = "all",
  initialOverdue = false,
}: {
  candidates: Candidate[];
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

  // The "All" view is a mixed-stage lookup list, so a single Score column would
  // be comparing scores across different stages — hide it there. It appears
  // only when a specific stage (or pending review) is selected, where every
  // visible row shares the same stage and the scores are comparable.
  const showScore = effectiveFilter !== "all";
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
      <div className="flex flex-col sm:flex-row items-center gap-3">
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
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
          />
        </div>

        <select
          value={effectiveSort}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="bg-white border border-[#E5E7EB] text-[#111827] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] w-full sm:w-auto"
        >
          <option value="applied_at">Sort by Newest</option>
          <option value="name">Sort A-Z</option>
          {showScore && <option value="score">Sort by Score</option>}
          {showOverdue && (
            <option value="stage_age">Sort by Longest in stage</option>
          )}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-[#E5E7EB] rounded-xl flex flex-col justify-center items-center">
          <div className="w-16 h-16 bg-[#EFF6FF] text-[#2563EB] rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
              />
            </svg>
          </div>
          <p className="text-[#6B7280]">No candidates found matching your criteria.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                <tr>
                  <th scope="col" className="w-10 pl-6 pr-0 py-4">
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
                  <th scope="col" className="px-6 py-4">
                    Candidate
                  </th>
                  <th scope="col" className="px-6 py-4">
                    Title / Company
                  </th>
                  <th scope="col" className="px-6 py-4">
                    Stage
                  </th>
                  {showScore && (
                    <th scope="col" className="px-6 py-4">
                      Score
                    </th>
                  )}
                  <th scope="col" className="px-6 py-4">
                    Applied
                  </th>
                  <th scope="col" className="px-6 py-4 text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((candidate) => {
                  const stageScore = showScore ? pipelineDisplayScore(candidate) : null;
                  return (
                    <tr
                      key={candidate.id}
                      className={`transition-colors group ${
                        selectedIds.has(candidate.id)
                          ? "bg-[#EFF6FF]"
                          : "hover:bg-[#F9FAFB]"
                      }`}
                    >
                      <td className="w-10 pl-6 pr-0 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(candidate.id)}
                          onChange={() => toggleRow(candidate.id)}
                          aria-label={`Select ${candidate.name}`}
                          className="h-4 w-4 cursor-pointer accent-[#2563EB]"
                        />
                      </td>
                      <td className="px-6 py-4">
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
                      </td>
                      <td className="px-6 py-4 text-[#4B5563]">
                        {candidate.current_title && candidate.current_company
                          ? `${candidate.current_title} at ${candidate.current_company}`
                          : candidate.current_title ||
                            candidate.current_company ||
                            "—"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
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
                          {candidate.awaiting_human_review && (
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
                      </td>
                      {showScore && (
                        <td className="px-6 py-4">
                          {stageScore ? (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[#111827]">
                                {stageScore.overall}
                              </span>
                              <span className="inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#F3F4F6] text-[#6B7280]">
                                {scoreStageTag[stageScore.stage]}
                              </span>
                              {stageScore.tier && (
                                <span
                                  className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                                    tierColors[stageScore.tier]
                                  }`}
                                >
                                  {TIER_LABELS[stageScore.tier]}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-4 text-[#4B5563]">
                        {new Date(candidate.applied_at).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Link
                          href={`/campaigns/${campaignId}/candidates/${candidate.id}`}
                          className="text-[#9CA3AF] hover:text-[#2563EB] transition-colors"
                        >
                          <svg
                            className="w-5 h-5 mx-auto"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </Link>
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
