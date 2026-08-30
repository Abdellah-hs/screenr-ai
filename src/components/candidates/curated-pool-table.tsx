"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AnchoredMenu,
  Button,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  Modal,
  ModalFooter,
  ModalHeader,
} from "@/components/ui";
import { PoolCurationFields } from "./pool-curation-fields";
import {
  removeFromTalentPool,
  updateTalentPoolCuration,
} from "@/lib/actions/talent-pool";
import {
  EMPTY_TALENT_POOL_FILTERS,
  type TalentPoolEntry,
  type TalentPoolFilters,
} from "@/lib/constants";
import { collectPoolTags, filterTalentPool } from "@/lib/talent-pool/search";
import {
  activePoolFilterChips,
  formatPoolAdded,
  hasPoolNarrowing,
  poolCountLabel,
  poolInitials,
  type PoolFilterChip,
} from "@/lib/talent-pool/view";
import { cn } from "@/lib/utils";

const ALL = "all";

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
  const [removing, setRemoving] = useState<TalentPoolEntry | null>(null);

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

  const campaignTitleById = useMemo(
    () => new Map(campaignOptions.map((c) => [c.id, c.title])),
    [campaignOptions],
  );

  const filtered = useMemo(() => filterTalentPool(entries, filters), [entries, filters]);

  // Anything beyond the always-visible search box counts as narrowing — the
  // count line has to say so, or a filtered-to-nothing pool reads as an empty
  // pool and the recruiter concludes their marks were lost.
  const narrowed = hasPoolNarrowing(filters);
  const searching = filters.query.trim().length > 0;
  const chips = activePoolFilterChips(filters, campaignTitleById);

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

  /** Dismissing a chip clears exactly the axis it names, and nothing else. */
  function clearChip(chip: PoolFilterChip) {
    switch (chip.kind) {
      case "tag":
        if (chip.tag) toggleTag(chip.tag);
        return;
      case "campaign":
        set("campaignId", null);
        return;
      case "score":
        setFilters((f) => ({ ...f, minScore: null, maxScore: null }));
        return;
      case "added":
        setFilters((f) => ({ ...f, addedFrom: null, addedTo: null }));
    }
  }

  if (entries.length === 0) return <EmptyPool />;

  return (
    // Fits whatever height the page gives it; only the card list scrolls, so
    // the search, the filter panel and the active-filter chips stay reachable
    // however far down the pool you are.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Search + filters ────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
            />
          </svg>
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search name, skill, tag or note…"
            aria-label="Search the talent pool"
            className="w-full rounded-lg border border-[#D1D5DB] bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-[#9CA3AF] transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20 outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2",
            narrowed
              ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
              : "border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F9FAFB] hover:text-ink",
          )}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
          </svg>
          Filters
          {chips.length > 0 && (
            <span className="rounded bg-[#1D4ED8] px-1.5 text-[11px] font-semibold tabular-nums text-white">
              {chips.length}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="mt-3 shrink-0 space-y-4 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
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
                        "inline-flex min-h-[28px] cursor-pointer items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2",
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
                className={POOL_FIELD}
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
                  className={POOL_FIELD}
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
                  className={POOL_FIELD}
                />
              </div>
              <p className="mt-1 text-[11px] text-[#9CA3AF]">
                Their best result at any stage. Unscored people are hidden while a bound is set.
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
                  className={POOL_FIELD}
                />
                <span className="text-sm text-[#9CA3AF]">to</span>
                <input
                  type="date"
                  aria-label="Added to"
                  value={filters.addedTo ?? ""}
                  onChange={(e) => set("addedTo", e.target.value || null)}
                  className={POOL_FIELD}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── What is currently narrowing the list ────────────────────────────
          Six axes can narrow this pool and only the search box is visible from
          the list itself. Without these, three people out of forty looks like a
          pool that lost its marks. */}
      {chips.length > 0 && (
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => clearChip(chip)}
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex min-h-[28px] cursor-pointer items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 text-xs font-medium text-[#1D4ED8] transition-colors duration-150 hover:bg-[#DBEAFE] focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
            >
              {chip.label}
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFilters({ ...EMPTY_TALENT_POOL_FILTERS, query: filters.query })}
            className="ml-1 min-h-[28px] cursor-pointer rounded-md px-2 text-xs font-semibold text-[#6B7280] transition-colors duration-150 hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
          >
            Clear all
          </button>
        </div>
      )}

      <p className="mb-3 mt-4 shrink-0 text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
        {poolCountLabel(filtered.length, entries.length, narrowed || searching)}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">Nobody in your pool matches this</p>
          <p className="mt-1 text-sm text-[#6B7280]">
            {entries.length} {entries.length === 1 ? "person is" : "people are"} in your pool.
            Clear a filter to see them.
          </p>
        </div>
      ) : (
        // `pr-1` keeps the hairline thumb off the card borders; `pb-1` stops
        // the last card sitting flush against the cut. AddMoreCard scrolls
        // with the list because it IS the end of the list.
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-1 pr-1">
          {filtered.map((entry) => (
            <PoolEntryCard
              key={entry.id}
              entry={entry}
              activeTags={filters.tags}
              onEdit={() => setEditing(entry)}
              onRemove={() => setRemoving(entry)}
              onToggleTag={toggleTag}
            />
          ))}

          {/* The pool only ever grows by hand, so the way to grow it belongs at
              the end of the list rather than only on the empty state. Hidden
              while narrowed: it is not an answer to "these filters match two
              people". */}
          {!narrowed && !searching && <AddMoreCard />}
        </div>
      )}

      <EditEntryModal
        entry={editing}
        suggestions={tagCounts.map((t) => t.tag)}
        onClose={() => setEditing(null)}
      />
      <RemoveEntryModal entry={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

const POOL_FIELD =
  "w-full cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-ink placeholder:text-[#9CA3AF] transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20 outline-none";

function EmptyPool() {
  return (
    <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#9CA3AF] shadow-sm">
        <svg
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-ink">Your talent pool is empty</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[#6B7280]">
        Nobody lands here automatically. Open a candidate and choose{" "}
        <span className="font-medium text-[#374151]">Add to talent pool</span> to keep them for a
        future role — or say yes to the prompt when you reject someone who was close.
      </p>
      <Link
        href="/candidates?view=all"
        className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
      >
        Browse all candidates
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}

function AddMoreCard() {
  return (
    <Link
      href="/candidates?view=all"
      className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#D1D5DB] bg-transparent px-4 py-5 text-sm font-medium text-[#6B7280] transition-colors duration-150 hover:border-[#9CA3AF] hover:bg-white hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      Add someone from all candidates
    </Link>
  );
}

function PoolEntryCard({
  entry,
  activeTags,
  onEdit,
  onRemove,
  onToggleTag,
}: {
  entry: TalentPoolEntry;
  activeTags: string[];
  onEdit: () => void;
  onRemove: () => void;
  onToggleTag: (tag: string) => void;
}) {
  return (
    <article className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-colors duration-150 hover:border-[#D1D5DB]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold tracking-wider text-white"
        >
          {poolInitials(entry.name, entry.email)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="truncate text-[15px] font-semibold text-ink">{entry.name}</h3>
            {entry.bestScore !== null && <BestScore value={entry.bestScore} />}
          </div>

          {entry.headline && (
            <p className="mt-0.5 truncate text-[13px] text-[#374151]">{entry.headline}</p>
          )}

          {/* One line, and the email and phone are live links — the whole point
              of a pool is getting back in touch months later. Inline anchors on
              purpose: the global 44px touch floor does not apply to them, so
              this stays a line of text rather than three stacked buttons. */}
          <p className="mt-1 truncate text-xs text-[#6B7280]">
            <a
              href={`mailto:${entry.email}`}
              className="transition-colors duration-150 hover:text-primary"
            >
              {entry.email}
            </a>
            {entry.phone && (
              <>
                {" · "}
                <a
                  href={`tel:${entry.phone}`}
                  className="transition-colors duration-150 hover:text-primary"
                >
                  {entry.phone}
                </a>
              </>
            )}
            {entry.location && ` · ${entry.location}`}
          </p>
        </div>

        <EntryActions entry={entry} onEdit={onEdit} onRemove={onRemove} />
      </div>

      {/* ── The curation: what the recruiter added ───────────────────────── */}
      <div className="mt-3 pl-0 sm:pl-13">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.tags.map((tag) => {
            const active = activeTags.some((t) => t.toLowerCase() === tag.toLowerCase());
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                aria-pressed={active}
                title={active ? `Stop filtering by "${tag}"` : `Show everyone tagged "${tag}"`}
                className={cn(
                  "inline-flex min-h-[26px] cursor-pointer items-center rounded-md px-2 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2",
                  active
                    ? "bg-[#1D4ED8] text-white"
                    : "bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE]",
                )}
              >
                {tag}
              </button>
            );
          })}

          {/* An untagged entry is the one this pool serves worst — it is a name
              with no reason attached. The way to fix that sits where the reason
              would be. */}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-[26px] cursor-pointer items-center gap-1 rounded-md border border-dashed border-[#D1D5DB] px-2 text-[11px] font-medium text-[#9CA3AF] transition-colors duration-150 hover:border-[#9CA3AF] hover:text-[#4B5563] focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {entry.tags.length === 0 ? "Add tags" : "Tag"}
          </button>
        </div>

        {entry.notes && (
          <p className="mt-2.5 whitespace-pre-wrap border-l-2 border-[#E5E7EB] pl-3 text-xs leading-relaxed text-[#4B5563]">
            {entry.notes}
          </p>
        )}

        <p className="mt-2.5 text-[11px] text-[#9CA3AF]">
          Added {formatPoolAdded(entry.addedAt)}
          {entry.sourceCampaignTitle && (
            <>
              {" from "}
              {entry.sourceCampaignId ? (
                <Link
                  href={`/campaigns/${entry.sourceCampaignId}`}
                  className="font-medium text-[#6B7280] transition-colors duration-150 hover:text-primary"
                >
                  {entry.sourceCampaignTitle}
                </Link>
              ) : (
                entry.sourceCampaignTitle
              )}
            </>
          )}
        </p>
      </div>
    </article>
  );
}

/**
 * The best number this person ever reached, at any stage of any campaign.
 *
 * Deliberately quiet, and deliberately not wearing the indigo AI rail: it is a
 * search axis over history, not a verdict on the person and not a composite
 * score — there is no such thing in this product. Dressed as a score it would
 * become one.
 */
function BestScore({ value }: { value: number }) {
  return (
    <span
      title="Their highest score at any stage of any campaign — history, not a verdict."
      className="inline-flex items-center gap-1 rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[#374151]"
    >
      {Math.round(value)}
      <span className="text-[#9CA3AF]">best</span>
    </span>
  );
}

/**
 * View is the action; the rest live under the "…".
 *
 * All three used to be equal-weight buttons side by side, so "Remove" — which
 * deletes the tags and notes with the entry — was as loud as opening the
 * person's record.
 */
function EntryActions({
  entry,
  onEdit,
  onRemove,
}: {
  entry: TalentPoolEntry;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {entry.sourceApplicationId && entry.sourceCampaignId && (
        <Link
          href={`/campaigns/${entry.sourceCampaignId}/candidates/${entry.sourceApplicationId}`}
          className="inline-flex cursor-pointer items-center rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
        >
          View
        </Link>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${entry.name}`}
        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-transparent text-[#6B7280] transition-colors duration-150 hover:bg-[#F3F4F6] hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} align="right">
        <button
          type="button"
          className={MENU_ITEM}
          onClick={() => {
            setOpen(false);
            onEdit();
          }}
        >
          <MenuIcon d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
          Edit tags &amp; notes
        </button>
        <button
          type="button"
          className={MENU_ITEM_DANGER}
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
        >
          <svg
            className="h-[15px] w-[15px] shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
            />
          </svg>
          Remove from pool
        </button>
      </AnchoredMenu>
    </div>
  );
}

function MenuIcon({ d }: { d: string }) {
  return (
    <svg
      className="h-[15px] w-[15px] shrink-0 text-[#6B7280]"
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
 * Removing an entry deletes the recruiter's own tags and notes with it, and
 * nothing on the old inline "Remove from pool? Yes / No" said so.
 */
function RemoveEntryModal({
  entry,
  onClose,
}: {
  entry: TalentPoolEntry | null;
  onClose: () => void;
}) {
  // Keyed like the edit modal, so a failed removal on one person cannot show
  // its error over the next person's confirmation.
  return entry ? <RemoveEntryConfirm key={entry.id} entry={entry} onClose={onClose} /> : null;
}

function RemoveEntryConfirm({
  entry,
  onClose,
}: {
  entry: TalentPoolEntry;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await removeFromTalentPool(entry.id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove");
      }
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>
        <h2 className="text-lg font-semibold text-ink">Remove {entry.name} from your pool?</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#6B7280]">
          {entry.tags.length > 0 || entry.notes
            ? "Your tags and notes on them are deleted with the entry. "
            : ""}
          Their candidate record, applications and history are untouched — this only removes the
          bookmark.
        </p>
      </ModalHeader>

      {error && <p className="text-sm text-[#B91C1C]">{error}</p>}

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={isPending}>
          {isPending ? "Removing…" : "Remove from pool"}
        </Button>
      </ModalFooter>
    </Modal>
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
        <h2 className="text-lg font-semibold text-ink">{entry.name}</h2>
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

      {error && <p className="mt-3 text-sm text-[#B91C1C]">{error}</p>}

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
