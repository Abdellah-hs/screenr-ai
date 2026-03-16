"use client";

import { useState } from "react";
import Link from "next/link";
import type { Tables } from "@/types/database.types";

type Campaign = Tables<"campaigns">;

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
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
    <>
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="closed">Closed</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="px-3 py-1.5 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="created_at">Newest first</option>
          <option value="title">Title A-Z</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border">
          <p className="text-muted">No campaigns found.</p>
          <Link
            href="/campaigns/new"
            className="inline-block mt-3 text-sm text-primary hover:underline font-medium"
          >
            Create your first campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              className="block p-5 bg-card rounded-xl border border-border hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                  {campaign.title}
                </h3>
                <span
                  className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${
                    statusColors[campaign.status ?? "draft"]
                  }`}
                >
                  {campaign.status}
                </span>
              </div>
              <p className="text-sm text-muted line-clamp-2 mb-3">
                {campaign.description}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted">
                {campaign.department && (
                  <span className="bg-surface px-2 py-0.5 rounded">
                    {campaign.department}
                  </span>
                )}
                <span>
                  {campaign.positions} position{campaign.positions !== 1 ? "s" : ""}
                </span>
                {campaign.deadline && (
                  <span>Due {new Date(campaign.deadline).toLocaleDateString()}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
