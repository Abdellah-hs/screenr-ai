import type { TalentPoolFilters } from "@/lib/constants";

/**
 * How the curated pool READS — pure, so the list component is left with
 * rendering only.
 *
 * The filter chips are the reason this module exists. Six axes narrow this
 * list and only one of them (the search box) is visible from the list itself,
 * so a recruiter could be looking at three people out of forty with nothing on
 * screen saying why. A pool that looks empty reads as marks that were lost.
 */

/** Initials from a display name, falling back to the first email character. */
export function poolInitials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return email.trim().charAt(0).toUpperCase();

  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Every axis except the search box, which has its own always-visible input.
 *
 * A boolean rather than an inline expression in the component so that adding a
 * seventh axis and forgetting to count it here is a test failure rather than a
 * silently under-reported filter.
 */
export function hasPoolNarrowing(filters: TalentPoolFilters): boolean {
  return (
    filters.tags.length > 0 ||
    filters.campaignId !== null ||
    filters.minScore !== null ||
    filters.maxScore !== null ||
    filters.addedFrom !== null ||
    filters.addedTo !== null
  );
}

/**
 * "12 people", or "3 of 12 people" once anything is narrowing the list. The
 * unfiltered case deliberately does NOT say "12 of 12" — a ratio that can only
 * ever be 1 is noise dressed as precision.
 */
export function poolCountLabel(shown: number, total: number, narrowed: boolean): string {
  const noun = total === 1 ? "person" : "people";
  if (!narrowed) return `${total} ${noun}`;
  if (shown === 0) return "No matches";
  return `${shown} of ${total} ${noun}`;
}

export type PoolFilterChipKind = "tag" | "campaign" | "score" | "added";

export interface PoolFilterChip {
  /** Stable React key. */
  id: string;
  kind: PoolFilterChipKind;
  label: string;
  /** Present on `tag` chips — which tag to drop when the chip is dismissed. */
  tag?: string;
}

/**
 * One dismissible chip per active narrowing, in the order the filter panel
 * lists them.
 *
 * Score and date are one chip each rather than one per bound: "Best 60+" and
 * "Best up to 80" are halves of a single range a recruiter set in one motion,
 * and dismissing half of a range leaves a filter nobody chose.
 */
export function activePoolFilterChips(
  filters: TalentPoolFilters,
  campaignTitleById: ReadonlyMap<string, string> = new Map(),
): PoolFilterChip[] {
  const chips: PoolFilterChip[] = [];

  for (const tag of filters.tags) {
    chips.push({ id: `tag:${tag}`, kind: "tag", label: tag, tag });
  }

  if (filters.campaignId !== null) {
    // A campaign the pool no longer has an entry from still has to name itself
    // — the entry that referenced it may have been removed while its filter
    // stayed set.
    const title = campaignTitleById.get(filters.campaignId) ?? "Unknown campaign";
    chips.push({ id: "campaign", kind: "campaign", label: `Campaign: ${title}` });
  }

  if (filters.minScore !== null || filters.maxScore !== null) {
    chips.push({ id: "score", kind: "score", label: scoreRangeLabel(filters) });
  }

  if (filters.addedFrom !== null || filters.addedTo !== null) {
    chips.push({ id: "added", kind: "added", label: addedRangeLabel(filters) });
  }

  return chips;
}

function scoreRangeLabel({ minScore, maxScore }: TalentPoolFilters): string {
  if (minScore !== null && maxScore !== null) return `Best ${minScore}–${maxScore}`;
  if (minScore !== null) return `Best ${minScore}+`;
  return `Best up to ${maxScore}`;
}

/**
 * Dates stay in `YYYY-MM-DD`. They came from a date input, both bounds are
 * inclusive, and re-formatting a bare date through `Date` shifts it a day in
 * any timezone west of UTC — on a chip whose whole job is to say exactly what
 * is being excluded.
 */
function addedRangeLabel({ addedFrom, addedTo }: TalentPoolFilters): string {
  if (addedFrom !== null && addedTo !== null) return `Added ${addedFrom} – ${addedTo}`;
  if (addedFrom !== null) return `Added from ${addedFrom}`;
  return `Added until ${addedTo}`;
}

/** "23 Aug 2026" — the day an entry was pooled. */
export function formatPoolAdded(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown date";

  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}
