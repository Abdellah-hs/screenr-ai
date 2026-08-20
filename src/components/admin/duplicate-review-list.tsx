"use client";

import { useState, useTransition } from "react";
import { resolveDuplicateFlagAction } from "@/lib/actions/duplicates";
import type {
  DuplicateCandidateSummary,
  DuplicateReviewItem,
} from "@/lib/data/duplicate-flags";
import { Modal, ModalFooter, ModalHeader, Textarea } from "@/components/ui";

type Decision = "approved" | "rejected";

interface ActiveResolution {
  flagId: string;
  decision: Decision;
  candidateName: string;
  matchedName: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DuplicateReviewList({
  items,
}: {
  items: DuplicateReviewItem[];
}) {
  const [active, setActive] = useState<ActiveResolution | null>(null);
  const [rationale, setRationale] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openResolution(item: DuplicateReviewItem, decision: Decision) {
    setError(null);
    setRationale("");
    setActive({
      flagId: item.flag.id,
      decision,
      candidateName: item.candidate.name,
      matchedName: item.matched.name,
    });
  }

  function closeModal() {
    if (isPending) return; // don't close mid-save
    setActive(null);
    setRationale("");
    setError(null);
  }

  function handleConfirm() {
    if (!active || rationale.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await resolveDuplicateFlagAction({
          flagId: active.flagId,
          decision: active.decision,
          rationale: rationale.trim(),
        });
        setNotice(
          res.decision === "approved"
            ? "Merged — the duplicate's applications moved onto the existing record."
            : "Kept separate — both records remain.",
        );
        setActive(null);
        setRationale("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-sm text-[#065F46]">
          <svg
            className="w-4 h-4 mt-0.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{notice}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white border border-[#E5E7EB] rounded-xl flex flex-col items-center">
          <div className="w-14 h-14 bg-[#ECFDF5] text-[#059669] rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-7 h-7"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-[#6B7280]">No duplicates to review — the queue is clear.</p>
        </div>
      ) : (
        items.map((item) => (
          <DuplicateCard
            key={item.flag.id}
            item={item}
            disabled={isPending}
            onResolve={(decision) => openResolution(item, decision)}
          />
        ))
      )}

      <Modal open={active !== null} onClose={closeModal}>
        {active && (
          <>
            <ModalHeader>
              <h2 className="text-lg font-semibold text-[#111827]">
                {active.decision === "approved"
                  ? "Merge duplicate records?"
                  : "Keep records separate?"}
              </h2>
              <p className="mt-1 text-sm text-[#6B7280]">
                {active.decision === "approved" ? (
                  <>
                    <span className="font-medium text-[#111827]">
                      {active.candidateName}
                    </span>{" "}
                    will be archived and its applications re-pointed onto{" "}
                    <span className="font-medium text-[#111827]">
                      {active.matchedName}
                    </span>
                    . This cannot be undone from here.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-[#111827]">
                      {active.candidateName}
                    </span>{" "}
                    and{" "}
                    <span className="font-medium text-[#111827]">
                      {active.matchedName}
                    </span>{" "}
                    will both be kept as separate candidates.
                  </>
                )}
              </p>
            </ModalHeader>

            <Textarea
              label="Reason for this decision"
              placeholder="Recorded on the duplicate flag for the audit trail."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={4}
              autoFocus
              disabled={isPending}
            />

            {error && <p className="mt-3 text-sm text-[#DC2626]">{error}</p>}

            <ModalFooter>
              <button
                type="button"
                onClick={closeModal}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer transition-colors hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending || rationale.trim().length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-[#111827] rounded-lg cursor-pointer transition-colors hover:bg-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending
                  ? "Saving…"
                  : active.decision === "approved"
                    ? "Merge records"
                    : "Keep separate"}
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}

function DuplicateCard({
  item,
  disabled,
  onResolve,
}: {
  item: DuplicateReviewItem;
  disabled: boolean;
  onResolve: (decision: Decision) => void;
}) {
  const signals = item.flag.match_signals;

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-medium text-[#6B7280]">Matched on:</span>
        {signals.email_match && (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-md bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
            Email
          </span>
        )}
        {signals.phone_match && (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-md bg-[#F5F3FF] text-[#7C3AED] border border-[#DDD6FE]">
            Phone
          </span>
        )}
        {!signals.email_match && !signals.phone_match && (
          <span className="text-xs text-[#9CA3AF]">profile similarity</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CandidatePanel
          label="Existing record"
          candidate={item.matched}
          accent="text-[#059669]"
        />
        <CandidatePanel
          label="Newly flagged"
          candidate={item.candidate}
          accent="text-[#D97706]"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-5">
        <button
          type="button"
          onClick={() => onResolve("approved")}
          disabled={disabled}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#111827] rounded-lg cursor-pointer transition-colors hover:bg-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Merge into existing
        </button>
        <button
          type="button"
          onClick={() => onResolve("rejected")}
          disabled={disabled}
          className="flex-1 px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Keep separate
        </button>
      </div>
    </div>
  );
}

function CandidatePanel({
  label,
  candidate,
  accent,
}: {
  label: string;
  candidate: DuplicateCandidateSummary;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${accent}`}>
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-[#111827]">{candidate.name}</p>
      <dl className="mt-2 space-y-1 text-xs text-[#4B5563]">
        <div className="flex gap-1.5">
          <dt className="text-[#9CA3AF] shrink-0">Email</dt>
          <dd className="truncate">{candidate.email}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-[#9CA3AF] shrink-0">Phone</dt>
          <dd>{candidate.phone || "—"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-[#9CA3AF] shrink-0">Added</dt>
          <dd>{formatDate(candidate.created_at)}</dd>
        </div>
      </dl>
    </div>
  );
}
