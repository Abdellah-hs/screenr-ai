"use server";

import { requireUserId } from "@/lib/auth/guards";
import { AUDIT_PAGE_SIZE } from "@/lib/constants";
import { auditLogFilterSchema } from "@/lib/validations";
import { toAuditCsv, toAuditJson, type AuditExport } from "@/lib/audit/export";
import {
  fetchAuditLog,
  type AuditLogFilters,
  type AuditLogPage,
  type AuditLogQuery,
} from "@/lib/data/audit-log";

/**
 * Audit Log reads (PRD 3.7.3). Every entry point re-checks the session and
 * scopes to the caller's own campaigns — the audit trail carries raw model
 * output and candidate names, so it is the last thing that should leak across
 * accounts.
 *
 * `"use server"`: only async functions may be exported from here, so the page
 * size lives in `constants.ts` and the shared shapes in the data/export modules.
 */

/** Rows a bounded export may contain before we make the auditor narrow it. */
const EXPORT_MAX_ROWS = 5_000;

/**
 * Widen a `YYYY-MM-DD` upper bound to the start of the NEXT day.
 *
 * The query uses a strict `<` on `created_at`, so passing the raw date would
 * mean "to: today" excluded everything logged today — the most likely thing an
 * auditor actually wants to see.
 */
function endOfDayExclusive(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function toFilters(query: AuditLogQuery): { filters: AuditLogFilters; page: number } {
  const parsed = auditLogFilterSchema.parse(query);

  return {
    filters: {
      campaignId: parsed.campaignId,
      candidateId: parsed.candidateId,
      stage: parsed.stage,
      from: parsed.from ? `${parsed.from}T00:00:00.000Z` : undefined,
      to: parsed.to ? endOfDayExclusive(parsed.to) : undefined,
      overriddenOnly: parsed.overriddenOnly,
    },
    page: parsed.page ?? 0,
  };
}

export async function getAuditLog(query: AuditLogQuery = {}): Promise<AuditLogPage> {
  const userId = await requireUserId();
  const { filters, page } = toFilters(query);

  return fetchAuditLog(userId, filters, page, AUDIT_PAGE_SIZE);
}

/**
 * Serialize the CURRENT filter selection for external compliance review.
 *
 * Re-runs the query rather than trusting rows posted back from the browser: an
 * export is evidence, and evidence assembled from client-supplied content is
 * not evidence. Paging is bypassed (an auditor wants the whole selection, not
 * page 1) but capped, so an unfiltered export on a large account fails loudly
 * instead of timing out halfway and handing over a truncated file that looks
 * complete.
 */
export async function exportAuditLog(
  query: AuditLogQuery = {},
  format: "csv" | "json" = "csv",
): Promise<AuditExport> {
  const userId = await requireUserId();
  const { filters } = toFilters(query);

  const { entries, total } = await fetchAuditLog(userId, filters, 0, EXPORT_MAX_ROWS);

  if (total > EXPORT_MAX_ROWS) {
    throw new Error(
      `That selection has ${total} rows, over the ${EXPORT_MAX_ROWS} export limit. Narrow the campaign or date range and try again.`,
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return format === "json"
    ? {
        filename: `audit-log-${stamp}.json`,
        mimeType: "application/json",
        content: toAuditJson(entries),
      }
    : {
        filename: `audit-log-${stamp}.csv`,
        mimeType: "text/csv",
        content: toAuditCsv(entries),
      };
}
