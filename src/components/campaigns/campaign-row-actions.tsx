"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { deleteCampaign } from "@/lib/actions/campaigns";
import { AnchoredMenu, Modal, ModalFooter, ModalHeader } from "@/components/ui";

/**
 * The "…" row-actions menu on the campaigns list: Edit (jump to the edit form)
 * and Remove (soft-delete behind a confirm step). Replaces the previously
 * decorative three-dot icon.
 */
export function CampaignRowActions({
  campaignId,
  campaignTitle,
}: {
  campaignId: string;
  campaignTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteCampaign(campaignId);
        // revalidatePath in the action re-renders the list without this row.
        setConfirming(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove campaign");
      }
    });
  }

  return (
    <>
      <div className="relative inline-block">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${campaignTitle}`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[#9CA3AF] cursor-pointer transition-colors hover:bg-[#F3F4F6] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
        </button>

        <AnchoredMenu
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          align="right"
          className="min-w-[160px]"
        >
          <Link
            href={`/campaigns/${campaignId}/edit`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-xs text-[#4B5563] cursor-pointer transition-colors hover:bg-[#F9FAFB]"
          >
            Edit campaign
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setError(null);
              setConfirming(true);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-[#DC2626] cursor-pointer transition-colors hover:bg-[#FEF2F2] focus-visible:outline-none focus-visible:bg-[#FEF2F2]"
          >
            Remove campaign
          </button>
        </AnchoredMenu>
      </div>

      <Modal open={confirming} onClose={() => !isPending && setConfirming(false)}>
        <ModalHeader>
          <h2 className="text-lg font-semibold text-[#111827]">Remove campaign</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Remove{" "}
            <span className="font-medium text-[#111827]">{campaignTitle}</span> from
            your openings? Its candidates and history are kept, but the campaign
            will no longer appear in your list.
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
            onClick={handleDelete}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] rounded-lg cursor-pointer transition-colors hover:bg-[#B91C1C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Removing…" : "Remove campaign"}
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
}
