"use client";

import { useState } from "react";
import Link from "next/link";
import type { Campaign } from "@/lib/constants";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { CampaignRowActions } from "@/components/campaigns/campaign-row-actions";
import { CampaignBulkActions } from "@/components/campaigns/campaign-bulk-actions";

type SortField = "created_at" | "title";

export default function CampaignFilters({ campaigns }: { campaigns: Campaign[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortField>("created_at");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Changing what's visible invalidates the current selection — clear it so a
  // bulk action can never touch a row the recruiter can no longer see.
  function clearSelection() {
    setSelected(new Set());
  }

  const filtered = campaigns
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .filter((c) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        (c.department ?? "").toLowerCase().includes(q) ||
        (c.location ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "title") {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Search / Filter visually wrapped */}
        <div className="relative w-full sm:max-w-sm">
           <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search by title, department, location…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              clearSelection();
            }}
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              clearSelection();
            }}
            className="bg-white border border-[#E5E7EB] text-[#111827] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] flex-1 sm:flex-none"
          >
            <option value="all">Filter: All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            className="bg-white border border-[#E5E7EB] text-[#111827] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] flex-1 sm:flex-none"
          >
            <option value="created_at">Sort by Newest</option>
            <option value="title">Sort A-Z</option>
          </select>
        </div>
      </div>

      {selectedInView.length > 0 && (
        <CampaignBulkActions
          selectedIds={selectedInView.map((c) => c.id)}
          selectedStatuses={selectedInView.map((c) => c.status ?? "draft")}
          onDone={clearSelection}
        />
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-[#E5E7EB] rounded-xl flex flex-col justify-center items-center">
          <div className="w-16 h-16 bg-[#EFF6FF] text-[#2563EB] rounded-full flex items-center justify-center mb-4">
             <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="text-[#6B7280]">No campaigns found matching your criteria.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-6 py-4 w-8 text-center text-[#D1D5DB]">
                    <input
                      type="checkbox"
                      aria-label="Select all campaigns"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={toggleAll}
                      className="rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                    />
                  </th>
                  <th scope="col" className="px-6 py-4">Title</th>
                  <th scope="col" className="px-6 py-4">Location</th>
                  <th scope="col" className="px-6 py-4">Positions</th>
                  <th scope="col" className="px-6 py-4">Department</th>
                  <th scope="col" className="px-6 py-4">Created</th>
                  <th scope="col" className="px-6 py-4">Status</th>
                  <th scope="col" className="px-6 py-4">Candidates</th>
                  <th scope="col" className="px-6 py-4 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((campaign) => {
                  const isSelected = selected.has(campaign.id);
                  return (
                  <tr
                    key={campaign.id}
                    className={`transition-colors group ${isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#F9FAFB]"}`}
                  >
                    <td className="px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${campaign.title}`}
                        checked={isSelected}
                        onChange={() => toggleOne(campaign.id)}
                        className={`rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/campaigns/${campaign.id}`} className="font-medium text-[#2563EB] hover:underline">
                        {campaign.title}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.location || "Remote"}
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.positions}
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.department || "-"}
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.created_at ? new Date(campaign.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <CampaignStatusChanger
                        campaignId={campaign.id}
                        currentStatus={campaign.status ?? "draft"}
                        acceptingApplications={campaign.accepting_applications}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/campaigns/${campaign.id}/candidates`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:underline"
                      >
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                        </svg>
                        Show candidates
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-center">
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
        </div>
      )}
    </div>
  );
}
