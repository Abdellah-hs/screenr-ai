import type { TalentPoolEntry, TalentPoolFilters } from "@/lib/constants";

/**
 * The 3.11.2 filter set, as a pure function.
 *
 * Pure and separate from both the query and the component because the pool is
 * small (people a recruiter hand-picked, not everyone who applied) and the
 * filters are multi-axis. Pushing six optional predicates into PostgREST would
 * buy nothing at this size and cost the ability to test the semantics — and the
 * semantics are where the real decisions are, not the SQL.
 *
 * Not in `src/lib/rules/` on purpose: rules decide application state. Nothing
 * here transitions anything; it narrows a list.
 */

/** Everything a free-text query is allowed to match, lowercased once. */
function searchableText(entry: TalentPoolEntry): string {
  return [
    entry.name,
    entry.email,
    entry.headline ?? "",
    entry.notes ?? "",
    ...entry.skills,
    ...entry.tags,
    ...entry.campaigns.map((c) => c.title),
  ]
    .join(" ")
    .toLowerCase();
}

/** Case-insensitive membership — tags are user-typed, so "React" == "react". */
function hasTag(entry: TalentPoolEntry, tag: string): boolean {
  const wanted = tag.trim().toLowerCase();
  return entry.tags.some((t) => t.trim().toLowerCase() === wanted);
}

/**
 * The date the entry was added, as `YYYY-MM-DD`.
 *
 * Compared as strings against the `<input type="date">` values so the bounds
 * are inclusive on both ends without any end-of-day arithmetic — "added on the
 * 5th" must match `addedTo: 2026-08-05`, and a naive `addedAt <= "2026-08-05"`
 * timestamp comparison silently excludes everything after midnight.
 */
function addedDay(entry: TalentPoolEntry): string {
  return entry.addedAt.slice(0, 10);
}

export function filterTalentPool(
  entries: TalentPoolEntry[],
  filters: TalentPoolFilters,
): TalentPoolEntry[] {
  const query = filters.query.trim().toLowerCase();
  const tags = filters.tags.filter((t) => t.trim().length > 0);
  const scoreBounded = filters.minScore !== null || filters.maxScore !== null;

  return entries.filter((entry) => {
    if (query && !searchableText(entry).includes(query)) return false;

    // AND, not OR: picking a second tag must narrow the list. A recruiter who
    // selects "react" and "senior" is describing one person, not two groups.
    if (tags.length > 0 && !tags.every((t) => hasTag(entry, t))) return false;

    if (filters.campaignId && !entry.campaigns.some((c) => c.id === filters.campaignId)) {
      return false;
    }

    if (scoreBounded) {
      // An unscored person is excluded the moment ANY bound is set — including
      // a max-only one. "Scored 60 or below" and "we never scored them" are
      // different facts, and showing the second as the first would put someone
      // in a result set that asserts something about them we never measured.
      if (entry.bestScore === null) return false;
      if (filters.minScore !== null && entry.bestScore < filters.minScore) return false;
      if (filters.maxScore !== null && entry.bestScore > filters.maxScore) return false;
    }

    const day = addedDay(entry);
    if (filters.addedFrom && day < filters.addedFrom) return false;
    if (filters.addedTo && day > filters.addedTo) return false;

    return true;
  });
}

/**
 * Every distinct tag across the pool, with how many entries carry it, most-used
 * first then alphabetical.
 *
 * Drives the tag filter UI and the suggestions on the edit form. Deduping is
 * case-insensitive but the *first* spelling seen wins as the display label —
 * folding everything to lowercase would render a recruiter's "Python" as
 * "python", and a taxonomy that silently rewrites what you typed is one people
 * stop trusting.
 */
export function collectPoolTags(
  entries: TalentPoolEntry[],
): { tag: string; count: number }[] {
  const byKey = new Map<string, { tag: string; count: number }>();

  for (const entry of entries) {
    // Within one entry a repeated tag counts once, so a duplicate stored on a
    // single row cannot inflate the tag's apparent popularity.
    const seen = new Set<string>();
    for (const raw of entry.tags) {
      const key = raw.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else byKey.set(key, { tag: raw.trim(), count: 1 });
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/**
 * Normalize a recruiter's tag input for storage: trimmed, empties dropped, and
 * deduped case-insensitively so "React" and "react" cannot both be stored on
 * one entry and then both show up in the filter list as separate tags.
 */
export function normalizePoolTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  return out;
}
