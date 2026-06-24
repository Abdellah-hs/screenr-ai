"use client";

import { useRef, useState, useTransition } from "react";
import {
  deleteCampaigns,
  updateCampaignsStatus,
} from "@/lib/actions/campaigns";
import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/lib/constants";
import { commonSettableCampaignStatuses } from "@/lib/rules/campaign-status";
import { AnchoredMenu, Modal, ModalFooter, ModalHeader } from "@/components/ui";

const STATUS_LABEL: Record<CampaignStatus, string> = Object.fromEntries(
  CAMPAIGN_STATUSES.map((s) => [s.value, s.label]),
) as Record<CampaignStatus, string>;

/**
 * Contextual toolbar shown when one or more campaigns are selected in the list.
 * Offers the two bulk row actions: set status (any status, via
 * commonSettableCampaignStatuses) and remove (soft-delete behind a confirm).
 * Clears the selection through `onDone` once an action succeeds.
 */
export function CampaignBulkActions({
  selectedIds,
  selectedStatuses,
  onDone,
}: {
  selectedIds: string[];
  selectedStatuses: CampaignStatus[];
  onDone: () => void;
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const statusBtnRef = useRef<HTMLButtonElement>(null);

  const count = selectedIds.length;
  const statusOptions = commonSettableCampaignStatuses(selectedStatuses);

  function runStatus(target: CampaignStatus) {
    setStatusMenuOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        await updateCampaignsStatus(selectedIds, target);
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update status");
      }
    });
  }

  function runDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteCampaigns(selectedIds);
        setConfirming(false);
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove campaigns");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
      <span className="text-sm font-medium text-[#1E40AF]">
        {count} selected
      </span>

      <div className="h-4 w-px bg-[#BFDBFE]" aria-hidden />

      <div className="relative">
        <button
          ref={statusBtnRef}
          type="button"
          onClick={() => setStatusMenuOpen((o) => !o)}
          disabled={isPending}
          aria-haspopup="menu"
          aria-expanded={statusMenuOpen}
          title="Set status for the selected campaigns"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1D4ED8] bg-white border border-[#BFDBFE] rounded-lg transition-colors hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          Set status
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <AnchoredMenu
          open={statusMenuOpen}
          onClose={() => setStatusMenuOpen(false)}
          anchorRef={statusBtnRef}
          align="left"
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Change status to
          </p>
          {statusOptions.map((status) => (
            <button
              key={status}
              type="button"
              role="menuitem"
              onClick={() => runStatus(status)}
              className="w-full text-left px-3 py-1.5 text-xs text-[#4B5563] cursor-pointer transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:bg-[#F9FAFB]"
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </AnchoredMenu>
      </div>

      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#DC2626] bg-white border border-[#FECACA] rounded-lg cursor-pointer transition-colors hover:bg-[#FEF2F2] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626]"
      >
        Remove
      </button>

      <button
        type="button"
        onClick={onDone}
        disabled={isPending}
        className="ml-auto text-sm font-medium text-[#6B7280] cursor-pointer transition-colors hover:text-[#111827] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Clear
      </button>

      {error && (
        <p className="w-full text-sm text-[#DC2626]">{error}</p>
      )}

      <Modal open={confirming} onClose={() => !isPending && setConfirming(false)}>
        <ModalHeader>
          <h2 className="text-lg font-semibold text-[#111827]">
            Remove {count} campaign{count === 1 ? "" : "s"}
          </h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Remove the selected campaign{count === 1 ? "" : "s"} from your
            openings? Candidates and history are kept, but{" "}
            {count === 1 ? "it" : "they"} will no longer appear in your list.
          </p>
        </ModalHeader>

        {error && <p className="text-sm text-[#DC2626]">{error}</p>}

        <ModalFooter>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer transition-colors hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runDelete}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] rounded-lg cursor-pointer transition-colors hover:bg-[#B91C1C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Removing…" : `Remove ${count === 1 ? "campaign" : "campaigns"}`}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
