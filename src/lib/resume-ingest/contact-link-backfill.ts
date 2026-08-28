import type { SupabaseDb } from "@/lib/supabase/types";
import {
  fetchApplicationsMissingContactLinks,
  downloadResumeFromStorage,
  saveBackfilledContactLinks,
  type IncompleteContactLinkRow,
} from "@/lib/data/candidates";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import {
  harvestContactLinks,
  organisationsNamedOn,
  type HarvestableLinks,
} from "@/lib/resume-ingest/contact-links";
import { resumeMimeTypeForPath } from "./mime";

/**
 * One-shot repair for CVs ingested before the deterministic link harvest.
 *
 * The harvest fixed the pipeline going forward, but every application already
 * on file keeps the nulls the extractor gave it. There is no cheap way back:
 * the ingest audit row stores only the resume text's *length*, so the markdown
 * Marker produced is not recoverable from the database — the document has to be
 * downloaded from storage and re-read. **That costs one Marker call per CV**,
 * which is why this is a deliberate, limited, dry-runnable sweep rather than
 * something that fires on a schedule. It is not listed in `vercel.json`.
 *
 * It re-reads the document only. No OpenAI call, no re-score, no transition:
 * the pipeline state of every application it touches is exactly what it was.
 * The only fields it can write are the three link fields, and only where they
 * are blank — the same "fills a blank, never changes an answer" rule the
 * harvest itself follows, so running it twice writes nothing the second time.
 *
 * **Writing nothing is not the same as costing nothing.** A repaired row leaves
 * the set and is never looked at again, but a CV that genuinely contains no
 * link stays a gap forever and is re-read — and re-paid for — on every
 * subsequent run. There is no "checked, nothing there" marker, and adding one
 * would mean a column to record the absence of a fact. So prefer a single pass
 * with a `limit` that covers the whole backlog (the dry run tells you how big
 * it is) over walking it in small batches.
 */

export interface ContactLinkBackfillResult {
  /** Applications examined — those with a resume file and a gap in the parse. */
  scanned: number;
  /** How many had at least one link recovered and written. */
  repaired: number;
  /** Re-read, but the document turned out to contain no link we could use. */
  unchanged: number;
  /** Download or extraction failed; logged, counted, and stepped over. */
  failed: number;
  /** True when nothing was written and no Marker call was made. */
  dryRun: boolean;
  /** Per-application detail, so a dry run says what it *would* do. */
  findings: ContactLinkFinding[];
}

export interface ContactLinkFinding {
  applicationId: string;
  /** Only the fields this run would fill — never the ones already answered. */
  fills: Partial<HarvestableLinks>;
}

/** A cap that exists so a mistake costs a handful of Marker calls, not a bill. */
export const BACKFILL_DEFAULT_LIMIT = 25;

/**
 * How many documents are re-read at once.
 *
 * The cap above bounds the COST — how many Marker calls a run may make — and
 * this bounds the WALL CLOCK, which was the thing actually stopping the run
 * from finishing. Marker is submit-then-poll with a budget of roughly three
 * minutes per document, so awaiting them one at a time meant that at a modest
 * twenty seconds each, the default limit of 25 needed 500 seconds against the
 * route's 300-second `maxDuration`. The limit was fiction: whatever an operator
 * asked for, about six to fifteen documents got done and the rest died with the
 * function.
 *
 * The number of calls is unchanged, so the cost is unchanged. Small because the
 * ceiling is somebody else's rate limit, not ours, and a backfill has nobody
 * waiting on it — overshooting trades a finished run for a throttled one.
 */
export const BACKFILL_CONCURRENCY = 4;

export interface BackfillArgs {
  db: SupabaseDb;
  /** Most applications to touch in one run. */
  limit?: number;
  /**
   * Count and report without downloading, extracting or writing anything.
   * A dry run makes no Marker call at all, so it is free — and therefore the
   * right way to find out how big the job is before paying for it.
   */
  dryRun?: boolean;
}

/** Blank means null, undefined, or whitespace — an empty string is an absence. */
function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/** Which of the three links this row is still missing, in both places. */
function gapsIn(row: IncompleteContactLinkRow): (keyof HarvestableLinks)[] {
  const keys: (keyof HarvestableLinks)[] = ["linkedin_url", "github_url", "portfolio_url"];
  return keys.filter(
    (key) => isBlank(row.parsedData?.[key]) && isBlank(row.candidate[key]),
  );
}

export async function backfillContactLinks({
  db,
  limit = BACKFILL_DEFAULT_LIMIT,
  dryRun = false,
}: BackfillArgs): Promise<ContactLinkBackfillResult> {
  const rows = await fetchApplicationsMissingContactLinks(limit, db);

  // The query's `or` filter is coarse (it fires on a gap in the parse alone),
  // so a row whose candidate record already carries the link is dropped here.
  // Re-reading a document to learn something we already know is the one cost
  // this sweep has no excuse for.
  const withGaps = rows
    .map((row) => ({ row, gaps: gapsIn(row) }))
    .filter(({ gaps }) => gaps.length > 0);

  const result: ContactLinkBackfillResult = {
    scanned: withGaps.length,
    repaired: 0,
    unchanged: 0,
    failed: 0,
    dryRun,
    findings: [],
  };

  // A dry run makes no Marker call at all, so it stays a straight pass: it is
  // free, and the whole point of it is to size the job before paying for it.
  if (dryRun) {
    for (const { row, gaps } of withGaps) {
      // Honest about what it does NOT know: without the document there is no
      // way to say whether a gap is fillable, only that it is a gap. The
      // finding names the fields at stake, not a promise to fill them.
      result.findings.push({
        applicationId: row.applicationId,
        fills: Object.fromEntries(gaps.map((key) => [key, null])),
      });
    }
    return result;
  }

  async function repairOne({ row, gaps }: (typeof withGaps)[number]): Promise<void> {
    try {
      const buffer = await downloadResumeFromStorage(row.resumeUrl, db);
      if (!buffer) {
        result.failed += 1;
        console.error(
          `contact-link backfill: resume ${row.resumeUrl} is no longer in storage (${row.applicationId})`,
        );
        return;
      }

      const mimeType = resumeMimeTypeForPath(row.resumeUrl);

      const { markdown } = await extractMarkdownWithMarker(buffer, mimeType);
      // The stored parse already names this candidate's employers and schools,
      // so the harvest can rule out their websites without re-reading the CV.
      const harvested = harvestContactLinks(markdown, organisationsNamedOn(row.parsedData));

      const fills: Partial<HarvestableLinks> = {};
      for (const key of gaps) {
        if (!isBlank(harvested[key])) fills[key] = harvested[key];
      }

      if (Object.keys(fills).length === 0) {
        result.unchanged += 1;
        return;
      }

      await saveBackfilledContactLinks(
        {
          applicationId: row.applicationId,
          candidateId: row.candidateId,
          parsedData: { ...row.parsedData, ...fills },
          candidate: { ...row.candidate, ...fills },
        },
        db,
      );

      result.repaired += 1;
      result.findings.push({ applicationId: row.applicationId, fills });
    } catch (err) {
      // One unreadable CV must not strand the rest of the run, and a partial
      // repair is still a repair — the next run picks up whatever it missed.
      result.failed += 1;
      console.error(`contact-link backfill failed for ${row.applicationId}:`, err);
    }
  }

  // A fixed pool rather than `Promise.all` over everything: the limit is an
  // operator's dial and may be 200, and 200 concurrent Marker submissions is
  // how a backfill becomes an incident. Each worker takes the next index, so a
  // slow document delays only itself.
  let next = 0;
  const workers = Array.from(
    { length: Math.min(BACKFILL_CONCURRENCY, withGaps.length) },
    async () => {
      while (next < withGaps.length) {
        await repairOne(withGaps[next++]);
      }
    },
  );
  await Promise.all(workers);

  return result;
}
