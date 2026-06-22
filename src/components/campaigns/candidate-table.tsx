"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { pipelineDisplayScore } from "@/lib/constants";
import type {
  Candidate,
  CandidateScore,
  CandidateStage,
} from "@/lib/constants";
import {
  ALL_FUNNEL_STAGE,
  FUNNEL_STAGES,
  ARCHIVED_FUNNEL_STAGE,
  FunnelCard,
  PipelineSummary,
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
};

const stageLabels: Record<CandidateStage, string> = {
  applied: "New",
  screening: "Screening",
  interview: "Interview",
  final_interview: "Final Interview",
  hired: "Hired",
  rejected: "Rejected",
};

type SortField = "name" | "applied_at" | "score";

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
}: {
  candidates: Candidate[];
  campaignId: string;
  /** Seeds the stage pill selection, e.g. from a `?stage=` deep link. */
  initialFilter?: string;
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>(initialFilter);
  const [sortBy, setSortBy] = useState<SortField>("applied_at");

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: candidates.length,
      pending_review: 0,
      archived: 0,
    };
    for (const c of candidates) {
      counts[c.stage] = (counts[c.stage] || 0) + 1;
      if (c.awaiting_human_review) counts.pending_review += 1;
      if (c.is_archived) counts.archived += 1;
    }
    // Archived candidates sit in the `rejected` coarse bucket but get their
    // own pill, so subtract them out to keep the two groups disjoint.
    counts.rejected = (counts.rejected ?? 0) - counts.archived;
    return counts;
  }, [candidates]);

  // The "Pending review" banner (and its filter) only exist while candidates
  // are actually awaiting review. Once the queue empties the banner disappears,
  // so a stale "pending_review" filter intent must fall back to "all" (handled
  // in effectiveFilter below) to avoid stranding the user on a hidden state.
  const pendingCount = stageCounts.pending_review ?? 0;
  const showPendingReview = pendingCount > 0;
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
  const effectiveSort: SortField =
    !showScore && sortBy === "score" ? "applied_at" : sortBy;

  // Funnel cards: an "All" reset card, the forward stages, then the terminal
  // Archived bucket (only when it has anyone).
  const stageCards = showArchived
    ? [...FUNNEL_STAGES, ARCHIVED_FUNNEL_STAGE]
    : FUNNEL_STAGES;
  const funnelStages = [ALL_FUNNEL_STAGE, ...stageCards];
  const total = candidates.length;
  const activeCount =
    (stageCounts.applied ?? 0) +
    (stageCounts.screening ?? 0) +
    (stageCounts.interview ?? 0) +
    (stageCounts.final_interview ?? 0);
  const hiredCount = stageCounts.hired ?? 0;
  const closedCount = total - activeCount - hiredCount;

  const filtered = useMemo(() => {
    return candidates
      .filter((c) => {
        if (effectiveFilter === "pending_review") {
          if (!c.awaiting_human_review) return false;
        } else if (effectiveFilter === "archived") {
          if (!c.is_archived) return false;
        } else if (effectiveFilter === "rejected") {
          // Rejected and Archived are disjoint groups — archived rows are
          // filed under their own pill, not here.
          if (c.stage !== "rejected" || c.is_archived) return false;
        } else if (effectiveFilter !== "all" && c.stage !== effectiveFilter) {
          return false;
        }
        if (search) {
          const q = search.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            (c.current_title ?? "").toLowerCase().includes(q) ||
            (c.current_company ?? "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (effectiveSort === "name") return a.name.localeCompare(b.name);
        if (effectiveSort === "score") {
          const sa = pipelineDisplayScore(a)?.overall ?? 0;
          const sb = pipelineDisplayScore(b)?.overall ?? 0;
          return sb - sa;
        }
        return (
          new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime()
        );
      });
  }, [candidates, search, effectiveFilter, effectiveSort]);

  return (
    <div className="space-y-4">
      {/* Pipeline funnel — doubles as the stage filter. Click a card to filter,
          click it again to clear. */}
      <div>
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

        <div className="mt-3">
          <PipelineSummary
            total={total}
            active={activeCount}
            hired={hiredCount}
            closed={closedCount}
          />
        </div>
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
                      className="hover:bg-[#F9FAFB] transition-colors group"
                    >
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
                                  className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                                    tierColors[stageScore.tier]
                                  }`}
                                >
                                  {stageScore.tier}
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
