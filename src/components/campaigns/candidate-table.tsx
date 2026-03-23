"use client";

import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateCandidateStage } from "@/lib/actions/candidates";
import { CANDIDATE_STAGE_TRANSITIONS, STAGE_LABELS } from "@/lib/constants";
import type { Candidate, CandidateStage } from "@/lib/constants";

const stageColors: Record<CandidateStage, string> = {
  applied: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  screening: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
  interview: "text-[#7C3AED] bg-[#F5F3FF] border-[#DDD6FE]",
  offer: "text-[#D97706] bg-[#FEF3C7] border-[#FDE68A]",
  hired: "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]",
  rejected: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

const tierColors: Record<string, string> = {
  strong: "text-[#059669] bg-[#ECFDF5]",
  moderate: "text-[#D97706] bg-[#FEF3C7]",
  weak: "text-[#DC2626] bg-[#FEF2F2]",
};

const stageLabels: Record<CandidateStage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

type SortField = "name" | "applied_at" | "score";

function getLatestScore(candidate: Candidate) {
  if (candidate.scores.length === 0) return null;
  return candidate.scores[candidate.scores.length - 1];
}

function StageActionMenu({ candidateId, currentStage }: { candidateId: string; currentStage: CandidateStage }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  const transitions = CANDIDATE_STAGE_TRANSITIONS[currentStage];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (transitions.length === 0) return null;

  function handleMove(stage: CandidateStage) {
    setOpen(false);
    startTransition(async () => {
      await updateCandidateStage(candidateId, stage);
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-all duration-200 cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
      >
        {isPending ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-[#E5E7EB] rounded-lg shadow-lg z-10 py-1">
          {transitions.map((stage) => (
            <button
              key={stage}
              onClick={() => handleMove(stage)}
              className={`w-full text-left px-4 py-2 text-sm cursor-pointer transition-colors ${
                stage === "rejected"
                  ? "text-[#DC2626] hover:bg-[#FEF2F2]"
                  : "text-[#111827] hover:bg-[#F9FAFB]"
              }`}
            >
              {stage === "rejected" ? "Reject" : `Move to ${STAGE_LABELS[stage]}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CandidateTable({
  candidates,
  campaignId,
}: {
  candidates: Candidate[];
  campaignId: string;
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortField>("applied_at");

  const filtered = useMemo(() => {
    return candidates
      .filter((c) => {
        if (stageFilter !== "all" && c.stage !== stageFilter) return false;
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
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "score") {
          const sa = getLatestScore(a)?.overall ?? 0;
          const sb = getLatestScore(b)?.overall ?? 0;
          return sb - sa;
        }
        return (
          new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime()
        );
      });
  }, [candidates, search, stageFilter, sortBy]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: candidates.length };
    for (const c of candidates) {
      counts[c.stage] = (counts[c.stage] || 0) + 1;
    }
    return counts;
  }, [candidates]);

  return (
    <div className="space-y-4">
      {/* Stage pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "all", label: "All" },
          { key: "applied", label: "Applied" },
          { key: "screening", label: "Screening" },
          { key: "interview", label: "Interview" },
          { key: "offer", label: "Offer" },
          { key: "hired", label: "Hired" },
          { key: "rejected", label: "Rejected" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStageFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              stageFilter === key
                ? "bg-[#2563EB] text-white border-[#2563EB]"
                : "bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]"
            }`}
          >
            {label}
            {stageCounts[key] != null && (
              <span className="ml-1.5 opacity-70">{stageCounts[key]}</span>
            )}
          </button>
        ))}
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
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="bg-white border border-[#E5E7EB] text-[#111827] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] w-full sm:w-auto"
        >
          <option value="applied_at">Sort by Newest</option>
          <option value="name">Sort A-Z</option>
          <option value="score">Sort by Score</option>
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
                  <th scope="col" className="px-6 py-4">
                    Score
                  </th>
                  <th scope="col" className="px-6 py-4">
                    Applied
                  </th>
                  <th scope="col" className="px-6 py-4 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((candidate) => {
                  const latestScore = getLatestScore(candidate);
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
                        <span
                          className={`inline-flex px-2.5 py-1 text-xs font-medium border rounded-md capitalize ${
                            stageColors[candidate.stage]
                          }`}
                        >
                          {stageLabels[candidate.stage]}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {latestScore ? (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#111827]">
                              {latestScore.overall}
                            </span>
                            {latestScore.tier && (
                              <span
                                className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                                  tierColors[latestScore.tier]
                                }`}
                              >
                                {latestScore.tier}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#9CA3AF]">—</span>
                        )}
                      </td>
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
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/campaigns/${campaignId}/candidates/${candidate.id}`}
                            className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                            title="View details"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                          <StageActionMenu candidateId={candidate.id} currentStage={candidate.stage} />
                        </div>
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
