"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { AI_AUDIT_STAGES, AUDIT_PAGE_SIZE } from "@/lib/constants";
import { exportAuditLog, getAuditLog } from "@/lib/actions/audit-log";
import type { AuditLogEntry, AuditLogQuery } from "@/lib/data/audit-log";

// Keyed by plain string, not AiAuditStage: `stage` is a text column, so a row
// written by a future AI call still renders (falling back to its raw value)
// rather than blanking the cell.
const STAGE_LABEL = new Map<string, string>(
  AI_AUDIT_STAGES.map((s) => [s.value as string, s.label]),
);

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Hand the serialized export to the browser as a file.
 *
 * The content comes from the server action — the browser never assembles the
 * evidence, it only saves what the server produced.
 */
function download({
  filename,
  mimeType,
  content,
}: {
  filename: string;
  mimeType: string;
  content: string;
}) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditLogTable({
  initialEntries,
  initialTotal,
  campaigns,
}: {
  initialEntries: AuditLogEntry[];
  initialTotal: number;
  campaigns: { id: string; title: string }[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<AuditLogQuery>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load(next: AuditLogQuery, nextPage: number) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await getAuditLog({ ...next, page: nextPage });
        setEntries(result.entries);
        setTotal(result.total);
        setPage(nextPage);
      } catch {
        setError("Couldn't load the audit log. Please try again.");
      }
    });
  }

  function updateFilter(patch: AuditLogQuery) {
    const next = { ...filters, ...patch };
    // Strip empty values so an unset dropdown doesn't become a filter on "".
    for (const k of Object.keys(next) as (keyof AuditLogQuery)[]) {
      if (next[k] === "" || next[k] === undefined || next[k] === false) delete next[k];
    }
    setFilters(next);
    load(next, 0);
  }

  function runExport(format: "csv" | "json") {
    setError(null);
    startTransition(async () => {
      try {
        download(await exportAuditLog(filters, format));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't export the audit log.",
        );
      }
    });
  }

  const lastPage = Math.max(0, Math.ceil(total / AUDIT_PAGE_SIZE) - 1);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField label="Campaign">
            <select
              className={FILTER_INPUT}
              value={filters.campaignId ?? ""}
              onChange={(e) => updateFilter({ campaignId: e.target.value })}
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Stage">
            <select
              className={FILTER_INPUT}
              value={filters.stage ?? ""}
              onChange={(e) => updateFilter({ stage: e.target.value })}
            >
              <option value="">All stages</option>
              {AI_AUDIT_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="From">
            <input
              type="date"
              className={FILTER_INPUT}
              value={filters.from ?? ""}
              onChange={(e) => updateFilter({ from: e.target.value })}
            />
          </FilterField>

          <FilterField label="To">
            <input
              type="date"
              className={FILTER_INPUT}
              value={filters.to ?? ""}
              onChange={(e) => updateFilter({ to: e.target.value })}
            />
          </FilterField>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#F3F4F6] pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#374151]">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB]"
              checked={filters.overriddenOnly ?? false}
              onChange={(e) => updateFilter({ overriddenOnly: e.target.checked })}
            />
            Only decisions a recruiter acted on afterwards
          </label>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => runExport("csv")}>
              Export CSV
            </Button>
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => runExport("json")}>
              Export JSON
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <tr className="text-xs uppercase tracking-wider text-[#6B7280]">
                <Th>When</Th>
                <Th>Candidate</Th>
                <Th>Campaign</Th>
                <Th>Stage</Th>
                <Th>Model</Th>
                <Th>Score</Th>
                <Th>Recruiter action</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-[#6B7280]">
                    {isPending ? "Loading…" : "No AI decisions match these filters."}
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <AuditRow
                    key={e.id}
                    entry={e}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pager */}
      {total > AUDIT_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-[#6B7280]">
          <span>
            {page * AUDIT_PAGE_SIZE + 1}–{Math.min((page + 1) * AUDIT_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page === 0 || isPending}
              onClick={() => load(filters, page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= lastPage || isPending}
              onClick={() => load(filters, page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const FILTER_INPUT =
  "w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm text-[#111827] cursor-pointer focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20";

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#6B7280]">{label}</span>
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-semibold">{children}</th>;
}

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const action = entry.recruiter_action_after;

  return (
    <>
      <tr className="hover:bg-[#F9FAFB]">
        <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
          {formatDateTime(entry.created_at)}
        </td>
        <td className="px-4 py-3 text-[#111827]">{entry.candidate_name ?? "—"}</td>
        <td className="px-4 py-3 text-[#6B7280]">{entry.campaign_title}</td>
        <td className="whitespace-nowrap px-4 py-3">
          <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-xs font-medium text-[#1D4ED8]">
            {STAGE_LABEL.get(entry.stage) ?? entry.stage}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-[#6B7280]">
          {entry.model}
          <span className="ml-1 text-[#9CA3AF]">({entry.prompt_version})</span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[#111827]">
          {entry.parsed_score ?? "—"}
        </td>
        <td className="px-4 py-3">
          {action ? (
            <span className="rounded-full bg-[#FFFBEB] px-2 py-0.5 text-xs font-medium text-[#B45309]">
              {action.to_state}
            </span>
          ) : (
            <span className="text-xs text-[#9CA3AF]">—</span>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-[#2563EB] transition-colors hover:bg-[#EFF6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            {expanded ? "Hide" : "Details"}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-[#F9FAFB]">
          <td colSpan={8} className="px-4 py-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <Field label="Prompt version" value={entry.prompt_version} />
                <Field label="Rubric version" value={entry.rubric_version ?? "—"} />
                <Field
                  label="Confidence"
                  value={entry.confidence != null ? String(entry.confidence) : "—"}
                />
                <Field label="Rationale" value={entry.rationale ?? "—"} />

                {action && (
                  <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#B45309]">
                      Recruiter action after this decision
                    </p>
                    <p className="mt-1 text-sm text-[#111827]">
                      {action.from_state ?? "—"} → {action.to_state}
                      {action.disposition_code && (
                        <span className="ml-2 text-xs text-[#92400E]">
                          ({action.disposition_code})
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-[#374151]">{action.rationale ?? "No rationale recorded"}</p>
                    <p className="mt-2 text-xs text-[#92400E]">
                      Paired by time on the same application. Whether it contradicted this AI
                      decision is for you to judge from both records.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Raw AI output
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-[#E5E7EB] bg-white p-3 text-xs text-[#111827]">
                    {entry.raw_output}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Input snapshot
                  </p>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-[#E5E7EB] bg-white p-3 text-xs text-[#111827]">
                    {JSON.stringify(entry.input_snapshot, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
      <p className="mt-0.5 text-sm text-[#111827]">{value}</p>
    </div>
  );
}
