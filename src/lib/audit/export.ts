import type { AuditLogEntry } from "@/lib/data/audit-log";

/** A serialized export, ready for the browser to save as a file. */
export interface AuditExport {
  filename: string;
  mimeType: string;
  content: string;
}

/**
 * Serialize audit rows for external compliance review (PRD 3.7.3).
 *
 * Pure and dependency-free so the escaping can be tested directly — which
 * matters more here than anywhere else in the codebase: `raw_output` is
 * unmodified model output, so it routinely contains quotes, commas and
 * newlines. Naive CSV joining would shift every subsequent column, and the
 * export is the artefact an auditor reads *instead of* the database. A quietly
 * malformed row is worse than a missing one, because nothing looks wrong.
 */

/** Column order is the contract — external tooling may depend on it. */
const COLUMNS = [
  "id",
  "created_at",
  "campaign_id",
  "campaign_title",
  "candidate_id",
  "candidate_name",
  "stage",
  "model",
  "prompt_version",
  "rubric_version",
  "parsed_score",
  "confidence",
  "rationale",
  "action_taken",
  "raw_output",
  "recruiter_action_at",
  "recruiter_action_to_state",
  "recruiter_action_rationale",
  "recruiter_action_disposition",
] as const;

/**
 * RFC 4180 escaping: wrap in double quotes and double any embedded quote.
 *
 * Always quoting (rather than only when needed) keeps newline-bearing model
 * output intact without a second code path deciding when quoting applies —
 * the branch that would eventually get it wrong.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toRow(e: AuditLogEntry): Record<(typeof COLUMNS)[number], unknown> {
  return {
    id: e.id,
    created_at: e.created_at,
    campaign_id: e.campaign_id,
    campaign_title: e.campaign_title,
    candidate_id: e.candidate_id,
    candidate_name: e.candidate_name,
    stage: e.stage,
    model: e.model,
    prompt_version: e.prompt_version,
    rubric_version: e.rubric_version,
    parsed_score: e.parsed_score,
    confidence: e.confidence,
    rationale: e.rationale,
    action_taken: e.action_taken,
    raw_output: e.raw_output,
    recruiter_action_at: e.recruiter_action_after?.at ?? null,
    recruiter_action_to_state: e.recruiter_action_after?.to_state ?? null,
    recruiter_action_rationale: e.recruiter_action_after?.rationale ?? null,
    recruiter_action_disposition: e.recruiter_action_after?.disposition_code ?? null,
  };
}

export function toAuditCsv(entries: AuditLogEntry[]): string {
  const header = COLUMNS.join(",");
  const lines = entries.map((e) => {
    const row = toRow(e);
    return COLUMNS.map((c) => csvCell(row[c])).join(",");
  });
  // CRLF per RFC 4180 — Excel is the most likely destination and is the least
  // forgiving reader of the two.
  return [header, ...lines].join("\r\n");
}

export function toAuditJson(entries: AuditLogEntry[]): string {
  // Pretty-printed: this is read by a human auditor, not parsed at volume.
  return JSON.stringify(entries, null, 2);
}
