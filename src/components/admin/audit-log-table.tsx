"use client";

import { useState, useTransition } from "react";
import {
  ActorMark,
  AiCaption,
  AiEyebrow,
  AiRail,
  Button,
  Skeleton,
} from "@/components/ui";
import { AI_AUDIT_STAGES, AUDIT_PAGE_SIZE } from "@/lib/constants";
import { exportAuditLog, getAuditLog } from "@/lib/actions/audit-log";
import {
  activeAuditFilterCount,
  auditCandidateCell,
  auditPageCount,
  auditRangeLabel,
  auditScoreCell,
  auditStageLabel,
  auditStageTone,
  auditTimeParts,
  recruiterActionLabel,
  type AuditStageTone,
} from "@/lib/audit/view";
import type { AuditLogEntry, AuditLogQuery } from "@/lib/data/audit-log";

/**
 * One tone per pipeline family, borrowed from the candidate table's stage
 * palette rather than invented here. Every badge on this page used to be the
 * same blue — the navigation colour — so the column carried nothing at a
 * glance and spent the one hue that is never a state.
 */
const STAGE_TONE: Record<AuditStageTone, string> = {
  resume: "bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]",
  screening: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
  interview: "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
  other: "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
};

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

  function clearFilters() {
    setFilters({});
    load({}, 0);
  }

  function runExport(format: "csv" | "json") {
    setError(null);
    startTransition(async () => {
      try {
        download(await exportAuditLog(filters, format));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't export the audit log.");
      }
    });
  }

  const activeFilters = activeAuditFilterCount(filters);
  const lastPage = auditPageCount(total, AUDIT_PAGE_SIZE) - 1;

  return (
    <div className="space-y-4">
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <section
        aria-label="Filter the audit trail"
        className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm"
      >
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[#F3F4F6] bg-[#FCFCFD] px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#374151]">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-[#D1D5DB] text-primary focus:ring-primary"
              checked={filters.overriddenOnly ?? false}
              onChange={(e) => updateFilter({ overriddenOnly: e.target.checked })}
            />
            Only decisions a recruiter acted on afterwards
          </label>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors duration-150 hover:bg-[#EFF6FF] focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
            >
              Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Said out loud: an export that quietly ignored the filters above
                would be a different artefact from the one on screen. */}
            <span className="hidden text-xs text-[#6B7280] sm:inline">
              Exports obey these filters
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => runExport("csv")}
            >
              <DownloadIcon />
              CSV
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => runExport("json")}
            >
              <DownloadIcon />
              JSON
            </Button>
          </div>
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
        >
          {error}
        </p>
      )}

      {/* ── The trail ───────────────────────────────────────────────────────
          Wrapped whole in the indigo rail rather than row by row: every line in
          this table is a model's output, so the attribution belongs to the
          object, not to each cell of it. */}
      <AiRail>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F3F4F6] px-5 py-3">
          <AiEyebrow>AI decision trail</AiEyebrow>
          <span className="text-xs tabular-nums text-[#6B7280]">
            {auditRangeLabel(page, AUDIT_PAGE_SIZE, total)}
          </span>
        </div>

        <div className="overflow-x-auto" aria-busy={isPending}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-[#6B7280]">
                <Th>When</Th>
                <Th>Candidate</Th>
                <Th>Stage</Th>
                <Th className="text-right">Score</Th>
                <Th>Model</Th>
                <Th>Recruiter action after</Th>
                <Th className="text-right">
                  <span className="sr-only">Evidence</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {isPending && entries.length === 0 ? (
                <LoadingRows />
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16">
                    <EmptyState filtered={activeFilters > 0} onClear={clearFilters} />
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

        <AiCaption fallibility="Every row here is a model's output, kept as evidence. None of it moved anybody on its own — a recruiter action beside a row is a separate, human decision." />
      </AiRail>

      {/* ── Pager ───────────────────────────────────────────────────────── */}
      {total > AUDIT_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-[#6B7280]">
          <span className="tabular-nums">
            Page {page + 1} of {lastPage + 1}
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
  "w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-ink cursor-pointer transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20 outline-none";

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#6B7280]">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={`whitespace-nowrap px-5 py-2.5 font-semibold ${className}`}>
      {children}
    </th>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

/** Grey lines rather than the word "Loading…", so the table keeps its shape. */
function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <tr key={i}>
          <td colSpan={7} className="px-5 py-3.5">
            <Skeleton className="h-5 w-full" />
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * "Nothing matched your filters" and "nothing has been logged" are different
 * facts with different next actions, so they are not one message.
 */
function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
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
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>
      </div>
      {filtered ? (
        <>
          <p className="font-medium text-ink">No AI decisions match these filters</p>
          <p className="mt-1 text-sm text-[#6B7280]">
            Widen the date range, or clear the filters to see the whole trail.
          </p>
          <button
            type="button"
            onClick={onClear}
            className="mt-4 cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
          >
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="font-medium text-ink">Nothing has been logged yet</p>
          <p className="mt-1 max-w-sm text-sm text-[#6B7280]">
            Every résumé parse, score and screening assessment lands here the moment it runs —
            with the raw output that produced it.
          </p>
        </>
      )}
    </div>
  );
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
  const when = auditTimeParts(entry.created_at);
  const who = auditCandidateCell(entry);
  const score = auditScoreCell(entry);
  const detailId = `audit-detail-${entry.id}`;

  return (
    <>
      <tr
        className={
          expanded ? "bg-[#FAFAFF]" : "transition-colors duration-150 hover:bg-[#F9FAFB]"
        }
      >
        <td className="whitespace-nowrap px-5 py-2.5 align-top">
          <span className="block text-[13px] text-[#374151]" title={when.full}>
            {when.date}
          </span>
          <span className="block text-xs tabular-nums text-[#9CA3AF]">{when.time}</span>
        </td>

        <td className="px-5 py-2.5 align-top">
          {who.kind === "named" ? (
            <span className="block font-medium text-ink">{who.text}</span>
          ) : (
            <span className="block text-[#9CA3AF]" title={who.hint}>
              {who.text}
            </span>
          )}
          <span className="mt-0.5 block text-xs text-[#6B7280]">{entry.campaign_title}</span>
        </td>

        <td className="whitespace-nowrap px-5 py-2.5 align-top">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              STAGE_TONE[auditStageTone(entry.stage)]
            }`}
          >
            {auditStageLabel(entry.stage)}
          </span>
        </td>

        <td className="whitespace-nowrap px-5 py-2.5 text-right align-top">
          {score.kind === "score" ? (
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[15px] font-semibold tabular-nums text-ink">{score.value}</span>
              <span className="text-[11px] text-[#9CA3AF]">{score.unit}</span>
            </span>
          ) : (
            <span className="text-xs text-[#9CA3AF]" title={score.hint}>
              {score.label}
            </span>
          )}
        </td>

        <td className="px-5 py-2.5 align-top">
          <span className="block text-[13px] text-[#374151]">{entry.model}</span>
          {/* Clipped, never dropped — an auditor needs the exact version, so the
              full string is on the title here and spelled out in the evidence
              panel below. */}
          <span
            title={entry.prompt_version}
            className="mt-0.5 inline-block max-w-[22ch] truncate rounded bg-[#F3F4F6] px-1.5 py-0.5 align-bottom font-mono text-[11px] text-[#6B7280]"
          >
            {entry.prompt_version}
          </span>
        </td>

        <td className="px-5 py-2.5 align-top">
          {action ? (
            <span className="flex items-center gap-2">
              <ActorMark actor="person" size="sm" />
              <span className="text-[13px] font-medium text-ink">
                {recruiterActionLabel(action.to_state)}
              </span>
            </span>
          ) : (
            <span
              className="text-xs text-[#9CA3AF]"
              title="No recruiter transition was recorded on this application after this decision."
            >
              None
            </span>
          )}
        </td>

        {/* Less vertical padding than its neighbours on purpose: the global
            44px touch-target floor applies to this button, so padding on top of
            it is what made every row of the old table 70px tall. */}
        <td className="whitespace-nowrap px-5 py-1 text-right align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailId}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors duration-150 hover:bg-[#EFF6FF] focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
          >
            {expanded ? "Hide" : "Evidence"}
            <svg
              className={`h-3.5 w-3.5 ${expanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </td>
      </tr>

      {expanded && (
        <tr id={detailId} className="bg-[#FAFAFF]">
          <td colSpan={7} className="px-5 pb-5 pt-1">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Chip label="Model" value={entry.model} />
                  <Chip label="Prompt" value={entry.prompt_version} />
                  <Chip label="Rubric" value={entry.rubric_version ?? "—"} />
                  <Chip
                    label="Confidence"
                    value={entry.confidence != null ? String(entry.confidence) : "not reported"}
                  />
                </div>

                <Panel title="Rationale">
                  <p className="text-sm leading-relaxed text-[#374151]">
                    {entry.rationale ?? "No rationale recorded."}
                  </p>
                </Panel>

                {action && (
                  <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                    <div className="flex items-center gap-2">
                      <ActorMark actor="person" size="sm" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                        What a person did next
                      </p>
                    </div>
                    <p className="mt-2 text-sm font-medium text-ink">
                      {recruiterActionLabel(action.to_state)}
                      {action.from_state && (
                        <span className="ml-1.5 font-normal text-[#6B7280]">
                          (from {recruiterActionLabel(action.from_state)})
                        </span>
                      )}
                    </p>
                    {action.disposition_code && (
                      <span className="mt-2 inline-block rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[11px] font-semibold text-[#B45309]">
                        {action.disposition_code}
                      </span>
                    )}
                    <p className="mt-2 text-sm text-[#374151]">
                      {action.rationale ?? "No rationale recorded"}
                    </p>
                    {/* Load-bearing: pairing is by time on the same application,
                        so this says a human acted afterwards — not that they
                        overrode anything. The audit log does not conclude. */}
                    <p className="mt-3 border-t border-[#F3F4F6] pt-2.5 text-xs leading-relaxed text-[#6B7280]">
                      Paired by time on the same application. Whether it contradicted this AI
                      decision is for you to judge from both records.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <Panel title="Raw AI output" copyText={entry.raw_output}>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[#111827]">
                    {entry.raw_output}
                  </pre>
                </Panel>
                <Panel
                  title="Input snapshot"
                  copyText={JSON.stringify(entry.input_snapshot, null, 2)}
                >
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[#111827]">
                    {JSON.stringify(entry.input_snapshot, null, 2)}
                  </pre>
                </Panel>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px]">
      <span className="text-[#6B7280]">{label}</span>
      <span className="font-mono font-medium text-ink">{value}</span>
    </span>
  );
}

function Panel({
  title,
  copyText,
  children,
}: {
  title: string;
  copyText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#F3F4F6] px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
          {title}
        </p>
        {copyText !== undefined && <CopyButton text={copyText} label={title} />}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/**
 * Copying the raw output is what an auditor actually does with it — into a
 * ticket, a report, a diff against another run. Selecting a scrolling `<pre>`
 * by hand is the failure this replaces.
 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // A browser that refuses clipboard access leaves the text selectable;
          // a failed copy is not worth an error banner over the evidence.
        }
      }}
      className="cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold text-primary transition-colors duration-150 hover:bg-[#EFF6FF] focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
