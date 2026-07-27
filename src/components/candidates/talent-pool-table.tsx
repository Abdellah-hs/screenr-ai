"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { restoreCampaign } from "@/lib/actions/campaigns";
import type {
  CandidateStage,
  ScreeningTier,
  TalentPoolApplication,
  TalentPoolCandidate,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

const stageColors: Record<CandidateStage, string> = {
  applied: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  screening: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
  interview: "text-[#7C3AED] bg-[#F5F3FF] border-[#DDD6FE]",
  final_interview: "text-[#D97706] bg-[#FEF3C7] border-[#FDE68A]",
  hired: "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]",
  rejected: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

const stageLabels: Record<CandidateStage, string> = {
  applied: "New",
  screening: "Screening",
  interview: "Interview",
  final_interview: "Final Interview",
  hired: "Hired",
  rejected: "Rejected",
};

const tierColors: Record<ScreeningTier, string> = {
  strong: "text-[#059669] bg-[#ECFDF5]",
  moderate: "text-[#D97706] bg-[#FEF3C7]",
  weak: "text-[#DC2626] bg-[#FEF2F2]",
  no_match: "text-[#B91C1C] bg-[#FEE2E2]",
};

const scoreStageTag: Record<"resume" | "screening" | "interview", string> = {
  resume: "Resume",
  screening: "Screening",
  interview: "Interview",
};

/** Initials from a display name, falling back to the first email character. */
function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return email.charAt(0).toUpperCase();
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

const ALL = "all";

export function TalentPoolTable({ people }: { people: TalentPoolCandidate[] }) {
  const [search, setSearch] = useState("");
  const [campaignFilter, setCampaignFilter] = useState<string>(ALL);

  // Campaign filter options = every distinct campaign present across the pool,
  // including removed ones (so you can pull up a removed campaign's cohort).
  const campaignOptions = useMemo(() => {
    const byId = new Map<string, { id: string; title: string; removed: boolean }>();
    for (const person of people) {
      for (const app of person.applications) {
        if (!byId.has(app.campaignId)) {
          byId.set(app.campaignId, {
            id: app.campaignId,
            title: app.campaignTitle,
            removed: app.campaignRemoved,
          });
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((person) => {
        if (
          q &&
          !person.name.toLowerCase().includes(q) &&
          !person.email.toLowerCase().includes(q)
        ) {
          return false;
        }
        if (campaignFilter !== ALL) {
          return person.applications.some((a) => a.campaignId === campaignFilter);
        }
        return true;
      })
      .map((person) => ({
        person,
        // When a specific campaign is picked, show only that origin per person
        // (the "candidates by campaign" cohort view); otherwise the full history.
        visibleApps:
          campaignFilter === ALL
            ? person.applications
            : person.applications.filter((a) => a.campaignId === campaignFilter),
      }));
  }, [people, search, campaignFilter]);

  if (people.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-6 py-16 text-center">
        <p className="text-sm font-medium text-[#111827]">No candidates yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[#6B7280]">
          People appear here once they apply to one of your campaigns. They stay
          in the pool even if a campaign is later removed.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-[#D1D5DB] bg-white py-2 pl-9 pr-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
          />
        </div>

        <label className="sr-only" htmlFor="talent-pool-campaign">
          Filter by campaign
        </label>
        <select
          id="talent-pool-campaign"
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20 sm:w-64"
        >
          <option value={ALL}>All campaigns</option>
          {campaignOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.removed ? " (removed)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Result count */}
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
        {filtered.length} {filtered.length === 1 ? "person" : "people"}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-6 py-12 text-center">
          <p className="text-sm text-[#6B7280]">No candidates match your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ person, visibleApps }) => (
            <PersonCard key={person.id} person={person} applications={visibleApps} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonCard({
  person,
  applications,
}: {
  person: TalentPoolCandidate;
  applications: TalentPoolApplication[];
}) {
  const meta = [person.location, person.phone].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 transition-colors hover:border-[#D1D5DB]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111827] text-xs font-bold tracking-wider text-white">
            {initials(person.name, person.email)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#111827]">{person.name}</p>
            <p className="truncate text-xs text-[#6B7280]">{person.email}</p>
            {meta && <p className="truncate text-xs text-[#9CA3AF]">{meta}</p>}
          </div>
        </div>

        {/* Application history — where they came from */}
        <div className="flex flex-col gap-2 sm:min-w-[20rem] sm:max-w-[32rem] sm:flex-1">
          {applications.map((app) => (
            <ApplicationRow key={app.applicationId} app={app} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ApplicationRow({ app }: { app: TalentPoolApplication }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#F3F4F6] bg-[#FAFAFA] px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              app.campaignRemoved ? "text-[#9CA3AF] line-through" : "text-[#111827]",
            )}
            title={app.campaignTitle}
          >
            {app.campaignTitle}
          </span>
          {app.campaignRemoved && (
            <span className="shrink-0 rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#B45309]">
              Removed
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
              stageColors[app.stage],
            )}
          >
            {stageLabels[app.stage]}
          </span>
          {app.score && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] font-medium text-[#374151]">
              {Math.round(app.score.overall)}
              <span className="text-[#9CA3AF]">· {scoreStageTag[app.score.stage]}</span>
            </span>
          )}
          {app.score?.tier && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                tierColors[app.score.tier],
              )}
            >
              {app.score.tier === "no_match" ? "No Match" : app.score.tier.charAt(0).toUpperCase() + app.score.tier.slice(1)}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {app.campaignRemoved ? (
          <RestoreCampaignButton campaignId={app.campaignId} />
        ) : (
          <Link
            href={`/campaigns/${app.campaignId}/candidates/${app.applicationId}`}
            className="inline-flex items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            View
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}

function RestoreCampaignButton({ campaignId }: { campaignId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRestore() {
    setError(null);
    startTransition(async () => {
      try {
        await restoreCampaign(campaignId);
        // revalidatePath in the action re-renders the pool without the removed flag.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restore");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onRestore}
        disabled={isPending}
        title="Restore this campaign so its candidates are reachable again"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
          isPending
            ? "cursor-default border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
            : "cursor-pointer border-[#A7F3D0] bg-[#ECFDF5] text-[#059669] hover:brightness-95",
        )}
      >
        {isPending ? (
          "Restoring…"
        ) : (
          <>
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Restore campaign
          </>
        )}
      </button>
      {error && <span className="text-[11px] text-[#DC2626]">{error}</span>}
    </div>
  );
}
