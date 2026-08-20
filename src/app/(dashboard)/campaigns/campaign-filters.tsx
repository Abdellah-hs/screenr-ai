"use client";

import { useState } from "react";
import Link from "next/link";
import type { Campaign, CampaignStatus } from "@/lib/constants";
import {
  pipelineSummaryText,
  type CampaignAttention,
  type CampaignBoardSummary,
} from "@/lib/campaigns/board-view";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { CampaignRowActions } from "@/components/campaigns/campaign-row-actions";
import { CampaignBulkActions } from "@/components/campaigns/campaign-bulk-actions";
import { PipelineBar, PipelineKey } from "@/components/campaigns/pipeline-bar";

/** Newest first, alphabetical, or worst-first by what is waiting on a person. */
type SortField = "created_at" | "title" | "attention";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
];

const EMPTY_SUMMARY: CampaignBoardSummary = {
  total: 0,
  buckets: {
    applied: 0,
    screening: 0,
    interview: 0,
    final_interview: 0,
    hired: 0,
    rejected: 0,
  },
  active: 0,
  overdue: 0,
  pendingReview: 0,
  awaitingDecision: 0,
  attention: { kind: "none", count: 0, label: "Nothing waiting", rank: 0 },
};

export default function CampaignFilters({
  campaigns,
  summaries,
}: {
  campaigns: Campaign[];
  summaries: Record<string, CampaignBoardSummary>;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortField>("created_at");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Changing what's visible invalidates the current selection — clear it so a
  // bulk action can never touch a row the recruiter can no longer see.
  function clearSelection() {
    setSelected(new Set());
  }

  function matchesSearch(c: Campaign) {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.department ?? "").toLowerCase().includes(q) ||
      (c.location ?? "").toLowerCase().includes(q)
    );
  }

  const searchMatches = campaigns.filter(matchesSearch);
  const filtered = searchMatches
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "attention") {
        const ra = summaries[a.id]?.attention ?? EMPTY_SUMMARY.attention;
        const rb = summaries[b.id]?.attention ?? EMPTY_SUMMARY.attention;
        // Rank decides the group; count breaks ties inside it, so "9 to
        // approve" outranks "1 to approve" without outranking anything late.
        if (rb.rank !== ra.rank) return rb.rank - ra.rank;
        if (rb.count !== ra.count) return rb.count - ra.count;
        return a.title.localeCompare(b.title);
      }
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });

  // Selection is always interpreted against the visible rows.
  const selectedInView = filtered.filter((c) => selected.has(c.id));
  const allChecked = filtered.length > 0 && selectedInView.length === filtered.length;
  const someChecked = selectedInView.length > 0 && !allChecked;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(filtered.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    clearSelection();
  }

  const narrowed = search.trim() !== "" || statusFilter !== "all";
  // Matches hidden purely by the status filter — the difference between "no
  // such campaign" and "not in this status", which are different problems.
  const hiddenByStatus = searchMatches.length - filtered.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
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
            placeholder="Search by title, department, location…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              clearSelection();
            }}
            aria-label="Search campaigns"
            className="w-full rounded-lg border border-[#D1D5DB] bg-white py-2 pl-9 pr-4 text-sm text-ink placeholder-[#9CA3AF] outline-none transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            clearSelection();
          }}
          aria-label="Filter campaigns by status"
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === "all" ? "Filter: All" : o.label}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          aria-label="Sort campaigns"
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20"
        >
          <option value="created_at">Sort by newest</option>
          <option value="title">Sort A–Z</option>
          <option value="attention">Sort by work waiting</option>
        </select>

        <p className="text-sm text-[#6B7280] sm:ml-auto">
          {narrowed
            ? `Showing ${filtered.length} of ${campaigns.length}`
            : `Showing all ${campaigns.length}`}
        </p>
      </div>

      {selectedInView.length > 0 && (
        <CampaignBulkActions
          selectedIds={selectedInView.map((c) => c.id)}
          selectedStatuses={selectedInView.map((c) => c.status ?? "draft")}
          onDone={clearSelection}
        />
      )}

      {filtered.length === 0 ? (
        <EmptyState
          narrowed={narrowed}
          search={search.trim()}
          statusFilter={statusFilter}
          hiddenByStatus={hiddenByStatus}
          onSearchAllStatuses={() => {
            setStatusFilter("all");
            clearSelection();
          }}
          onClearFilters={clearFilters}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F9FAFB] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                <tr className="border-b border-[#E5E7EB]">
                  <th scope="col" className="w-10 py-3 pl-5 pr-0">
                    <input
                      type="checkbox"
                      aria-label="Select all campaigns"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={toggleAll}
                      className="h-[15px] w-[15px] cursor-pointer accent-ink"
                    />
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Pipeline
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Needs you
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Positions
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Created
                  </th>
                  <th scope="col" className="w-14 py-3 pl-3 pr-5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((campaign) => {
                  const isSelected = selected.has(campaign.id);
                  const summary = summaries[campaign.id] ?? EMPTY_SUMMARY;
                  const status = (campaign.status ?? "draft") as CampaignStatus;
                  return (
                    <tr
                      key={campaign.id}
                      className={`border-b border-[#F3F4F6] transition-colors duration-150 ${
                        isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#F9FAFB]"
                      }`}
                    >
                      <td className="py-3.5 pl-5 pr-0">
                        <input
                          type="checkbox"
                          aria-label={`Select ${campaign.title}`}
                          checked={isSelected}
                          onChange={() => toggleOne(campaign.id)}
                          className="h-[15px] w-[15px] cursor-pointer accent-ink"
                        />
                      </td>

                      <td className="px-3 py-3.5">
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="block font-semibold text-ink transition-colors duration-150 hover:text-primary"
                        >
                          {campaign.title}
                        </Link>
                        <span className="mt-0.5 block text-xs text-[#6B7280]">
                          {[campaign.department, campaign.location]
                            .filter(Boolean)
                            .join(" · ") || "No department or location set"}
                        </span>
                      </td>

                      <td className="px-3 py-3.5">
                        <CampaignStatusChanger
                          campaignId={campaign.id}
                          currentStatus={status}
                          acceptingApplications={campaign.accepting_applications}
                        />
                      </td>

                      <td className="px-3 py-3.5">
                        <Link
                          href={`/campaigns/${campaign.id}/candidates`}
                          className="block space-y-1.5"
                        >
                          <PipelineBar
                            buckets={summary.buckets}
                            total={summary.total}
                            muted={status === "closed"}
                          />
                          <span
                            className={`block text-xs ${
                              summary.total === 0 ? "text-[#9CA3AF]" : "text-[#4B5563]"
                            }`}
                          >
                            {pipelineSummaryText(summary, status)}
                          </span>
                        </Link>
                      </td>

                      <td className="px-3 py-3.5">
                        <NeedsYou attention={summary.attention} campaignId={campaign.id} />
                      </td>

                      <td className="px-3 py-3.5 text-right tabular-nums text-[#4B5563]">
                        {summary.buckets.hired} of {campaign.positions}
                      </td>

                      <td className="px-3 py-3.5 text-[#4B5563]">
                        {campaign.created_at
                          ? new Date(campaign.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>

                      <td className="py-3.5 pl-3 pr-5 text-right">
                        <CampaignRowActions
                          campaignId={campaign.id}
                          campaignTitle={campaign.title}
                          publicSlug={campaign.public_slug}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PipelineKey />
        </section>
      )}
    </div>
  );
}

/**
 * The single most consequential thing waiting on the recruiter, as a link
 * straight to it. "Nothing waiting" stays plain text — there is nowhere useful
 * to send someone whose campaign is quiet.
 */
function NeedsYou({
  attention,
  campaignId,
}: {
  attention: CampaignAttention;
  campaignId: string;
}) {
  if (attention.kind === "none") {
    return <span className="text-xs text-[#9CA3AF]">Nothing waiting</span>;
  }

  const tone =
    attention.kind === "past_sla"
      ? "bg-[#FEE2E2] border-[#FCA5A5] text-[#991B1B]"
      : "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]";

  const href =
    attention.kind === "past_sla"
      ? `/campaigns/${campaignId}/candidates?overdue=1`
      : attention.kind === "to_approve"
        ? `/campaigns/${campaignId}/candidates?stage=pending_review`
        : attention.kind === "to_decide"
          ? `/campaigns/${campaignId}/candidates?stage=interview`
          : `/campaigns/${campaignId}#screening-questions`;

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors duration-150 hover:brightness-95 ${tone}`}
    >
      <AttentionIcon kind={attention.kind} />
      {attention.label}
    </Link>
  );
}

function AttentionIcon({ kind }: { kind: CampaignAttention["kind"] }) {
  const d =
    kind === "past_sla"
      ? "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      : kind === "no_questions"
        ? "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
        : "M9 12.8l2.3 2.2L15 9.8M21 12a9 9 0 11-18 0 9 9 0 0118 0z";

  return (
    <svg
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/**
 * Three different emptinesses, three different next actions: no campaigns at
 * all, nothing matching the search, and matches that exist but sit in another
 * status. The last one used to read as the first, which sends a recruiter off
 * to create a campaign they already have.
 */
function EmptyState({
  narrowed,
  search,
  statusFilter,
  hiddenByStatus,
  onSearchAllStatuses,
  onClearFilters,
}: {
  narrowed: boolean;
  search: string;
  statusFilter: string;
  hiddenByStatus: number;
  onSearchAllStatuses: () => void;
  onClearFilters: () => void;
}) {
  const statusLabel =
    STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "this status";

  if (!narrowed) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-[#E5E7EB] bg-white px-6 py-16 text-center">
        <p className="text-base font-semibold text-ink">No openings yet</p>
        <p className="mt-1.5 max-w-md text-sm text-[#6B7280]">
          A campaign holds one role: its rubric, its screening questions, its apply
          link, and everyone who applies to it.
        </p>
        <Link href="/campaigns/new" className="btn-primary mt-5 inline-flex">
          Create the first campaign
        </Link>
      </div>
    );
  }

  const headline = search
    ? statusFilter === "all"
      ? `No campaigns match “${search}”`
      : `No campaigns match “${search}” in ${statusLabel}`
    : `No campaigns are ${statusLabel}`;

  return (
    <div className="flex flex-col items-center rounded-xl border border-[#E5E7EB] bg-white px-6 py-16 text-center">
      <p className="text-base font-semibold text-ink">{headline}</p>
      {hiddenByStatus > 0 && (
        <p className="mt-1.5 text-sm text-[#6B7280]">
          {hiddenByStatus} {hiddenByStatus === 1 ? "campaign matches" : "campaigns match"}{" "}
          in other statuses.
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {hiddenByStatus > 0 && (
          <button type="button" onClick={onSearchAllStatuses} className="btn-secondary">
            Search all statuses
          </button>
        )}
        <button type="button" onClick={onClearFilters} className="btn-secondary">
          Clear filters
        </button>
      </div>
    </div>
  );
}
