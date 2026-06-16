"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { pipelineDisplayScore } from "@/lib/constants";
import type {
  AutomationMode,
  Candidate,
  CandidateScore,
  CandidateStage,
} from "@/lib/constants";

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
  automationMode,
}: {
  candidates: Candidate[];
  campaignId: string;
  automationMode: AutomationMode;
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortField>("applied_at");

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: candidates.length,
      pending_review: 0,
    };
    for (const c of candidates) {
      counts[c.stage] = (counts[c.stage] || 0) + 1;
      if (c.awaiting_human_review) counts.pending_review += 1;
    }
    return counts;
  }, [candidates]);

  // If the "Pending review" pill is no longer rendered (e.g. recruiter
  // approved the last pending candidate on a fully_auto campaign), don't
  // leave the user filtered to a hidden state with no visible reset —
  // derive the effective filter from the requested one, so a stale
  // "pending_review" intent silently behaves as "all".
  const showPendingReview =
    automationMode === "human_in_loop" || stageCounts.pending_review > 0;
  const effectiveFilter =
    stageFilter === "pending_review" && !showPendingReview ? "all" : stageFilter;

  // The "All" view is a mixed-stage lookup list, so a single Score column would
  // be comparing scores across different stages — hide it there. It appears
  // only when a specific stage (or pending review) is selected, where every
  // visible row shares the same stage and the scores are comparable.
  const showScore = effectiveFilter !== "all";
  const effectiveSort: SortField =
    !showScore && sortBy === "score" ? "applied_at" : sortBy;

  const filtered = useMemo(() => {
    return candidates
      .filter((c) => {
        if (effectiveFilter === "pending_review") {
          if (!c.awaiting_human_review) return false;
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
      {/* Stage pills */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: "All" },
            { key: "applied", label: "New" },
            ...(showPendingReview
              ? [{ key: "pending_review", label: "Pending review" }]
              : []),
            { key: "screening", label: "Screening" },
            { key: "interview", label: "Interview" },
            { key: "final_interview", label: "Final Interview" },
            { key: "hired", label: "Hired" },
            { key: "rejected", label: "Rejected" },
          ] as { key: string; label: string }[]
        ).map(({ key, label }) => {
          const isPending = key === "pending_review";
          const isActive = effectiveFilter === key;
          const inactiveClasses = isPending
            ? "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A] hover:bg-[#FEF3C7]"
            : "bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]";
          return (
            <button
              key={key}
              onClick={() => setStageFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? "bg-[#2563EB] text-white border-[#2563EB]"
                  : inactiveClasses
              }`}
            >
              {label}
              {stageCounts[key] != null && (
                <span className="ml-1.5 opacity-70">{stageCounts[key]}</span>
              )}
            </button>
          );
        })}
      </div>

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
                          <span
                            className={`inline-flex px-2.5 py-1 text-xs font-medium border rounded-md capitalize ${
                              stageColors[candidate.stage]
                            }`}
                          >
                            {stageLabels[candidate.stage]}
                          </span>
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
