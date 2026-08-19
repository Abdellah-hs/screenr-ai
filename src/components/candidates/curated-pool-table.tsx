"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui";
import { PoolCurationFields } from "./pool-curation-fields";
import {
  removeFromTalentPool,
  updateTalentPoolCuration,
} from "@/lib/actions/talent-pool";
import { EMPTY_TALENT_POOL_FILTERS, type TalentPoolEntry, type TalentPoolFilters } from "@/lib/constants";
import { collectPoolTags, filterTalentPool } from "@/lib/talent-pool/search";
import { cn } from "@/lib/utils";

const ALL = "all";

/** Initials from a display name, falling back to the first email character. */
function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return email.charAt(0).toUpperCase();
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

function formatAdded(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Parse a score input, treating empty and nonsense alike as "no bound". */
function parseBound(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function CuratedPoolTable({ entries }: { entries: TalentPoolEntry[] }) {
  const [filters, setFilters] = useState<TalentPoolFilters>(EMPTY_TALENT_POOL_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<TalentPoolEntry | null>(null);

  const tagCounts = useMemo(() => collectPoolTags(entries), [entries]);

  const campaignOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of entries) {
      for (const c of entry.campaigns) if (!byId.has(c.id)) byId.set(c.id, c.title);
    }
    return [...byId.entries()]
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [entries]);

  const filtered = useMemo(() => filterTalentPool(entries, filters), [entries, filters]);

  // Anything beyond the always-visible search box counts as narrowing — the
  // count line has to say so, or a filtered-to-nothing pool reads as an empty
  // pool and the recruiter concludes their marks were lost.
  const narrowed =
    filters.tags.length > 0 ||
    filters.campaignId !== null ||
    filters.minScore !== null ||
    filters.maxScore !== null ||
    filters.addedFrom !== null ||
    filters.addedTo !== null;

  function set<K extends keyof TalentPoolFilters>(key: K, value: TalentPoolFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function toggleTag(tag: string) {
    setFilters((f) => ({
      ...f,
      tags: f.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? f.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...f.tags, tag],
    }));
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-6 py-16 text-center">
        <p className="text-sm font-medium text-[#111827]">Your talent pool is empty</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[#6B7280]">
          Nobody lands here automatically. Open a candidate and choose{" "}
          <span className="font-medium text-[#374151]">Add to talent pool</span> to
          keep them for a future role — or say yes to the prompt when you reject
          someone who was close.
        </p>
        <Link
          href="/candidates?view=all"
          className="mt-4 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          Browse all candidates
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Search + filter toggle */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
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
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search name, skill, tag or note…"
            className="w-full rounded-lg border border-[#D1D5DB] bg-white py-2 pl-9 pr-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
            narrowed
              ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
              : "border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F9FAFB]",
          )}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
          </svg>
          Filters
          {narrowed && <span className="rounded bg-[#1D4ED8] px-1.5 text-[11px] font-semibold text-white">on</span>}
        </button>

        {narrowed && (
          <button
            type="button"
            onClick={() => setFilters({ ...EMPTY_TALENT_POOL_FILTERS, query: filters.query })}
            className="cursor-pointer rounded-lg px-2 py-2 text-sm font-medium text-[#6B7280] transition-colors hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            Clear
          </button>
        )}
      </div>

      {showFilters && (
        <div className="mb-5 space-y-4 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
          {tagCounts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tagCounts.map(({ tag, count }) => {
                  const active = filters.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
                        active
                          ? "border-[#1D4ED8] bg-[#1D4ED8] text-white"
                          : "border-[#E5E7EB] bg-white text-[#374151] hover:border-[#BFDBFE] hover:bg-[#EFF6FF]",
                      )}
                    >
                      {tag}
                      <span className={active ? "text-[#BFDBFE]" : "text-[#9CA3AF]"}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="pool-campaign"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#9CA3AF]"
              >
                Original campaign
              </label>
              <select
                id="pool-campaign"
                value={filters.campaignId ?? ALL}
                onChange={(e) => set("campaignId", e.target.value === ALL ? null : e.target.value)}
                className="w-full cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
              >
                <option value={ALL}>Any campaign</option>
                {campaignOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
                Best score
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  aria-label="Minimum score"
                  value={filters.minScore ?? ""}
                  onChange={(e) => set("minScore", parseBound(e.target.value))}
                  placeholder="Min"
                  className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9CA3AF] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
                />
                <span className="text-sm text-[#9CA3AF]">to</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  aria-label="Maximum score"
                  value={filters.maxScore ?? ""}
                  onChange={(e) => set("maxScore", parseBound(e.target.value))}
                  placeholder="Max"
                  className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9CA3AF] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
                />
              </div>
              <p className="mt-1 text-[11px] text-[#9CA3AF]">
                Their best result at any stage. Unscored people are hidden while a
                bound is set.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
                Added
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="Added from"
                  value={filters.addedFrom ?? ""}
                  onChange={(e) => set("addedFrom", e.target.value || null)}
                  className="w-full cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
                />
                <span className="text-sm text-[#9CA3AF]">to</span>
                <input
                  type="date"
                  aria-label="Added to"
                  value={filters.addedTo ?? ""}
                  onChange={(e) => set("addedTo", e.target.value || null)}
                  className="w-full cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
        {filtered.length} of {entries.length} {entries.length === 1 ? "person" : "people"}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-6 py-12 text-center">
          <p className="text-sm text-[#6B7280]">
            Nobody in your pool matches these filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <PoolEntryCard key={entry.id} entry={entry} onEdit={() => setEditing(entry)} />
          ))}
        </div>
      )}

      <EditEntryModal
        entry={editing}
        suggestions={tagCounts.map((t) => t.tag)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function PoolEntryCard({
  entry,
  onEdit,
}: {
  entry: TalentPoolEntry;
  onEdit: () => void;
}) {
  const meta = [entry.location, entry.phone].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 transition-colors hover:border-[#D1D5DB]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111827] text-xs font-bold tracking-wider text-white">
            {initials(entry.name, entry.email)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-[#111827]">{entry.name}</p>
              {entry.bestScore !== null && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] font-medium text-[#374151]">
                  {Math.round(entry.bestScore)}
                  <span className="text-[#9CA3AF]">best</span>
                </span>
              )}
            </div>
            <p className="truncate text-xs text-[#6B7280]">{entry.email}</p>
            {entry.headline && (
              <p className="truncate text-xs text-[#374151]">{entry.headline}</p>
            )}
            {meta && <p className="truncate text-xs text-[#9CA3AF]">{meta}</p>}

            {entry.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-[#EFF6FF] px-1.5 py-0.5 text-[11px] font-medium text-[#1D4ED8]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {entry.notes && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[#FAFAFA] px-2.5 py-1.5 text-xs leading-relaxed text-[#4B5563]">
                {entry.notes}
              </p>
            )}

            <p className="mt-2 text-[11px] text-[#9CA3AF]">
              Added {formatAdded(entry.addedAt)}
              {entry.sourceCampaignTitle ? ` from ${entry.sourceCampaignTitle}` : ""}
            </p>
          </div>
        </div>

        <EntryActions entry={entry} onEdit={onEdit} />
      </div>
    </div>
  );
}

function EntryActions({ entry, onEdit }: { entry: TalentPoolEntry; onEdit: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onRemove() {
    setError(null);
    startTransition(async () => {
      try {
        await removeFromTalentPool(entry.id);
        setConfirming(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove");
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        {entry.sourceApplicationId && entry.sourceCampaignId && (
          <Link
            href={`/campaigns/${entry.sourceCampaignId}/candidates/${entry.sourceApplicationId}`}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            View
          </Link>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setConfirming((v) => !v)}
          aria-expanded={confirming}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-medium text-[#9CA3AF] transition-colors hover:border-[#FECACA] hover:bg-[#FEF2F2] hover:text-[#DC2626] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          Remove
        </button>
      </div>

      {confirming && (
        <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2 py-1">
          <span className="text-[11px] text-[#991B1B]">Remove from pool?</span>
          <button
            type="button"
            onClick={onRemove}
            disabled={isPending}
            className="cursor-pointer text-[11px] font-semibold text-[#DC2626] transition-colors hover:text-[#991B1B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default disabled:text-[#9CA3AF]"
          >
            {isPending ? "Removing…" : "Yes"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="cursor-pointer text-[11px] font-medium text-[#6B7280] transition-colors hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            No
          </button>
        </div>
      )}

      {error && <span className="text-[11px] text-[#DC2626]">{error}</span>}
    </div>
  );
}

function EditEntryModal({
  entry,
  suggestions,
  onClose,
}: {
  entry: TalentPoolEntry | null;
  suggestions: string[];
  onClose: () => void;
}) {
  // Keyed on the entry id so opening a different person resets the draft rather
  // than carrying the previous person's tags into their card.
  return entry ? (
    <EditEntryForm key={entry.id} entry={entry} suggestions={suggestions} onClose={onClose} />
  ) : null;
}

function EditEntryForm({
  entry,
  suggestions,
  onClose,
}: {
  entry: TalentPoolEntry;
  suggestions: string[];
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateTalentPoolCuration({ entryId: entry.id, tags, notes });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>
        <h2 className="text-lg font-semibold text-[#111827]">{entry.name}</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Tags and notes are yours — they never reach the candidate.
        </p>
      </ModalHeader>

      <PoolCurationFields
        tags={tags}
        notes={notes}
        onTagsChange={setTags}
        onNotesChange={setNotes}
        suggestions={suggestions}
        disabled={isPending}
      />

      {error && <p className="mt-3 text-sm text-[#DC2626]">{error}</p>}

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="cursor-pointer rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#374151] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default disabled:bg-[#9CA3AF]"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
