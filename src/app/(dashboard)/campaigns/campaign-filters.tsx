"use client";

import { useState } from "react";
import Link from "next/link";
import type { Campaign } from "@/lib/constants";

const statusColors: Record<string, string> = {
  draft: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  active: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
  paused: "text-[#D97706] bg-[#FEF3C7] border-[#FDE68A]",
  closed: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

type SortField = "created_at" | "title";

export default function CampaignFilters({ campaigns }: { campaigns: Campaign[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortField>("created_at");

  const filtered = campaigns
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });

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
            placeholder="Search by name, role"
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
          
          <button className="bg-white border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] text-sm font-medium rounded-lg px-4 py-2 flex items-center gap-2 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export
          </button>
        </div>
      </div>

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
                    <input type="checkbox" className="rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB]" />
                  </th>
                  <th scope="col" className="px-6 py-4">Applied Role</th>
                  <th scope="col" className="px-6 py-4">Location</th>
                  <th scope="col" className="px-6 py-4">Candidates</th>
                  <th scope="col" className="px-6 py-4">Department</th>
                  <th scope="col" className="px-6 py-4">Applied Date</th>
                  <th scope="col" className="px-6 py-4">Stage</th>
                  <th scope="col" className="px-6 py-4 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-[#F9FAFB] transition-colors group">
                    <td className="px-6 py-4 text-center">
                      <input type="checkbox" className="rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/campaigns/${campaign.id}`} className="font-medium text-[#2563EB] hover:underline">
                        {campaign.title}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.location || "Remote"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex -space-x-2">
                        {/* Mock Avatar Stack */}
                        {[...Array(Math.min(campaign.positions || 1, 3))].map((_, i) => (
                           <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-[#E5E7EB] flex items-center justify-center text-xs font-bold text-[#6B7280]">
                             {campaign.title.charAt(i)}
                           </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.department || "-"}
                    </td>
                    <td className="px-6 py-4 text-[#4B5563]">
                      {campaign.created_at ? new Date(campaign.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-1 text-xs font-medium border rounded-md capitalize ${statusColors[campaign.status ?? "draft"]}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-[#9CA3AF] cursor-pointer hover:text-[#111827]">
                      <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
