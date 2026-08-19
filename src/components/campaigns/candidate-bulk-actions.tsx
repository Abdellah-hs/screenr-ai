"use client";

import { useMemo, useState, useTransition } from "react";
import { bulkCandidateAction } from "@/lib/actions/bulk-candidates";
import { PoolCurationFields } from "@/components/candidates/pool-curation-fields";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui";
import { formatApplicationState, type Candidate } from "@/lib/constants";
import { planBulkAction, type BulkAction, type BulkResult } from "@/lib/rules/bulk-actions";

/** Mirrors the server-side floor in `bulkCandidateActionSchema`. */
const MIN_RATIONALE = 10;

interface ActionCopy {
  button: string;
  title: string;
  /** What happens, in the recruiter's terms. */
  consequence: string;
  confirm: string;
  placeholder: string;
  tone: "neutral" | "danger" | "positive";
}

/**
 * One entry per action, so the toolbar and the modal can never disagree about
 * what a button does.
 */
const COPY: Record<BulkAction, ActionCopy> = {
  advance: {
    button: "Advance",
    title: "Advance candidates",
    consequence:
      "Each candidate moves one stage forward from wherever they are now, and is emailed if that stage sends one. Every move is recorded separately with your reasoning.",
    confirm: "Advance",
    placeholder: "e.g. Reviewed as a group in the Tuesday hiring sync — all clear to interview.",
    tone: "positive",
  },
  reject: {
    button: "Reject",
    title: "Reject candidates",
    consequence:
      "Each candidate is closed and emailed a rejection. Your reasoning stays internal — the email never exposes scores or comparisons. This cannot be undone in bulk.",
    confirm: "Reject",
    placeholder: "e.g. Role scope narrowed to payments; these profiles are strong but not a match.",
    tone: "danger",
  },
  talent_pool: {
    button: "Add to talent pool",
    title: "Add to talent pool",
    consequence:
      "Saves each person for future roles with the tags and note below. Nothing about their current application changes, and the candidate is never told.",
    confirm: "Add to pool",
    placeholder: "",
    tone: "neutral",
  },
};

const toneClasses: Record<ActionCopy["tone"], string> = {
  positive:
    "text-[#047857] border-[#A7F3D0] hover:bg-[#ECFDF5] focus-visible:ring-[#059669]",
  danger: "text-[#DC2626] border-[#FECACA] hover:bg-[#FEF2F2] focus-visible:ring-[#DC2626]",
  neutral: "text-[#1D4ED8] border-[#BFDBFE] hover:bg-[#F9FAFB] focus-visible:ring-[#2563EB]",
};

const confirmClasses: Record<ActionCopy["tone"], string> = {
  positive: "bg-[#059669] hover:bg-[#047857] focus-visible:ring-[#059669]",
  danger: "bg-[#DC2626] hover:bg-[#B91C1C] focus-visible:ring-[#DC2626]",
  neutral: "bg-[#111827] hover:bg-[#374151] focus-visible:ring-[#2563EB]",
};

/**
 * Contextual toolbar for a candidate selection (PRD 3.12.1), shaped after
 * `CampaignBulkActions` so the two feel like one feature.
 *
 * The confirmation is not a formality. It runs the same pure `planBulkAction`
 * the server does and shows the split *before* the recruiter commits — so
 * "advance 40" that will really advance 12 says so up front, rather than
 * reporting the surprise afterwards.
 */
export function CandidateBulkActions({
  selected,
  onDone,
}: {
  selected: Candidate[];
  onDone: () => void;
}) {
  const [action, setAction] = useState<BulkAction | null>(null);
  const [rationale, setRationale] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const count = selected.length;

  const plan = useMemo(() => {
    if (!action) return null;
    return planBulkAction(
      selected.map((c) => ({
        applicationId: c.id,
        name: c.name,
        currentState: c.status,
      })),
      action,
    );
  }, [selected, action]);

  function open(next: BulkAction) {
    setAction(next);
    setRationale("");
    setTags([]);
    setNotes("");
    setResult(null);
    setError(null);
  }

  function close() {
    if (isPending) return;
    setAction(null);
    setResult(null);
  }

  function submit() {
    if (!action) return;
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await bulkCandidateAction({
          applicationIds: selected.map((c) => c.id),
          action,
          rationale: action === "talent_pool" ? undefined : rationale.trim(),
          tags: action === "talent_pool" ? tags : undefined,
          notes: action === "talent_pool" ? notes : undefined,
        });
        // The modal stays open on the result rather than closing: a batch that
        // skipped or failed anyone has something the recruiter needs to read,
        // and a toast that disappears is not where that belongs.
        setResult(outcome);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The batch could not be run");
      }
    });
  }

  const copy = action ? COPY[action] : null;
  const needsRationale = action !== null && action !== "talent_pool";
  const remaining = MIN_RATIONALE - rationale.trim().length;
  const eligibleCount = plan?.eligible.length ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3">
      <span className="text-sm font-medium text-[#1E40AF]">{count} selected</span>

      <div className="h-4 w-px bg-[#BFDBFE]" aria-hidden />

      {(Object.keys(COPY) as BulkAction[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => open(key)}
          disabled={isPending}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            toneClasses[COPY[key].tone]
          }`}
        >
          {COPY[key].button}
        </button>
      ))}

      <button
        type="button"
        onClick={onDone}
        disabled={isPending}
        className="ml-auto cursor-pointer text-sm font-medium text-[#6B7280] transition-colors hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Clear
      </button>

      <Modal open={action !== null} onClose={close} className="max-w-[560px]">
        {copy && (
          <>
            <ModalHeader>
              <h2 className="text-lg font-semibold text-[#111827]">
                {result ? "Done" : `${copy.title} · ${eligibleCount} of ${count}`}
              </h2>
              <p className="mt-1 text-sm text-[#6B7280]">
                {result
                  ? "Every candidate in the batch is accounted for below."
                  : copy.consequence}
              </p>
            </ModalHeader>

            {result ? (
              <ResultSummary result={result} />
            ) : (
              <>
                {plan && plan.skipped.length > 0 && (
                  <SkipPreview skipped={plan.skipped} />
                )}

                {action === "talent_pool" ? (
                  <PoolCurationFields
                    tags={tags}
                    notes={notes}
                    onTagsChange={setTags}
                    onNotesChange={setNotes}
                    disabled={isPending}
                    notesPlaceholder="e.g. Strong shortlist from the platform round — revisit for the next opening."
                  />
                ) : (
                  <>
                    <label
                      htmlFor="bulk-rationale"
                      className="mb-1.5 block text-xs font-medium text-[#374151]"
                    >
                      Why? This is recorded against every candidate in the batch.
                    </label>
                    <textarea
                      id="bulk-rationale"
                      rows={3}
                      value={rationale}
                      disabled={isPending}
                      onChange={(e) => setRationale(e.target.value)}
                      placeholder={copy.placeholder}
                      className="w-full resize-y rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] outline-none transition-colors focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:opacity-50"
                    />
                    {remaining > 0 && (
                      <p className="mt-1 text-[11px] text-[#9CA3AF]">
                        {remaining} more character{remaining === 1 ? "" : "s"} needed
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {error && <p className="mt-3 text-sm text-[#DC2626]">{error}</p>}

            <ModalFooter>
              {result ? (
                <button
                  type="button"
                  onClick={() => {
                    setAction(null);
                    setResult(null);
                    onDone();
                  }}
                  className="cursor-pointer rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#374151] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={close}
                    disabled={isPending}
                    className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition-colors hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={
                      isPending ||
                      eligibleCount === 0 ||
                      (needsRationale && remaining > 0)
                    }
                    title={
                      eligibleCount === 0
                        ? "None of the selected candidates can take this action"
                        : undefined
                    }
                    className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#9CA3AF] ${
                      confirmClasses[copy.tone]
                    }`}
                  >
                    {isPending
                      ? "Working…"
                      : `${copy.confirm} ${eligibleCount} candidate${eligibleCount === 1 ? "" : "s"}`}
                  </button>
                </>
              )}
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}

/**
 * Who will be left out, and why, before the recruiter commits.
 *
 * Reporting skips only afterwards would be technically honest and practically
 * useless: by then they have already pressed the button on a count that was
 * never going to happen.
 */
function SkipPreview({
  skipped,
}: {
  skipped: { applicationId: string; name: string; skipReason: string | null }[];
}) {
  return (
    <div className="mb-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
      <p className="text-xs font-medium text-[#92400E]">
        {skipped.length} will be skipped
      </p>
      <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
        {skipped.map((s) => (
          <li key={s.applicationId} className="text-[11px] leading-relaxed text-[#B45309]">
            <span className="font-medium">{s.name}</span> — {s.skipReason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultSummary({ result }: { result: BulkResult }) {
  const problems = result.outcomes.filter((o) => o.status !== "succeeded");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Tally label="Succeeded" value={result.succeeded} tone="positive" />
        <Tally label="Skipped" value={result.skipped} tone="warning" />
        <Tally label="Failed" value={result.failed} tone="danger" />
      </div>

      {problems.length > 0 && (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2">
          {problems.map((o) => (
            <li key={o.applicationId} className="text-[11px] leading-relaxed text-[#4B5563]">
              <span className="font-medium text-[#111827]">{o.name}</span>
              <span className={o.status === "failed" ? "text-[#DC2626]" : "text-[#B45309]"}>
                {" "}
                · {o.status}
              </span>
              {o.detail && <> — {o.detail}</>}
            </li>
          ))}
        </ul>
      )}

      {result.succeeded > 0 && (
        <p className="text-[11px] text-[#9CA3AF]">
          {result.outcomes
            .filter((o) => o.status === "succeeded" && o.toState)
            .slice(0, 1)
            .map((o) => `Moved to ${formatApplicationState(o.toState!)} and recorded on each candidate's history.`)}
        </p>
      )}
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "positive" | "warning" | "danger";
}) {
  const styles = {
    positive: "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]",
    warning: "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]",
    danger: "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]",
  }[tone];

  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${styles}`}
    >
      <span className="text-sm font-bold">{value}</span>
      {label}
    </span>
  );
}
