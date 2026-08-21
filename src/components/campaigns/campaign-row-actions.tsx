"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { cloneCampaign, deleteCampaign } from "@/lib/actions/campaigns";
import {
  AnchoredMenu,
  MenuNote,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  Modal,
  ModalFooter,
  ModalHeader,
} from "@/components/ui";

function MenuIcon({ d }: { d: string }) {
  return (
    <svg
      className="h-[15px] w-[15px] shrink-0 text-[#6B7280]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/**
 * The "…" row-actions menu on the campaigns list: Edit (jump to the edit form)
 * and Remove (soft-delete behind a confirm step). Replaces the previously
 * decorative three-dot icon.
 */
export function CampaignRowActions({
  campaignId,
  campaignTitle,
  publicSlug,
}: {
  campaignId: string;
  campaignTitle: string;
  /** Absent on a campaign that has never had a public apply page. */
  publicSlug?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleClone() {
    setError(null);
    setOpen(false);
    startTransition(async () => {
      try {
        await cloneCampaign(campaignId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to clone campaign");
      }
    });
  }

  async function copyApplyLink() {
    if (!publicSlug) return;
    setOpen(false);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/apply/${publicSlug}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions). The link is always
      // reachable from the campaign page, so this stays silent rather than
      // throwing an error at someone who asked for a convenience.
    }
  }

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
        >
          <Link
            href={`/campaigns/${campaignId}/edit`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={MENU_ITEM}
          >
            <MenuIcon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            Edit campaign
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleClone}
            disabled={isPending}
            className={MENU_ITEM}
          >
            <MenuIcon d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            Clone as draft
          </button>
          {publicSlug && (
            <button
              type="button"
              role="menuitem"
              onClick={copyApplyLink}
              className={MENU_ITEM}
            >
              <MenuIcon d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m4.5-4.5 1.5-1.5a4 4 0 115.656 5.656l-3 3a4 4 0 01-5.656 0" />
              {copied ? "Apply link copied" : "Copy apply link"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setError(null);
              setConfirming(true);
            }}
            className={MENU_ITEM_DANGER}
          >
            <MenuIcon d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            Remove campaign…
          </button>
          <MenuNote>Removing keeps every candidate and their history.</MenuNote>
        </AnchoredMenu>

        {error && !confirming && (
          <p className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs text-[#DC2626]">
            {error}
          </p>
        )}
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
