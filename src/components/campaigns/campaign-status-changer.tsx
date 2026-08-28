"use client";

import { useRef, useState, useTransition } from "react";
import { updateCampaignStatus } from "@/lib/actions/campaigns";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_SELECTIONS,
  type CampaignStatus,
  type CampaignStatusSelection,
} from "@/lib/constants";
import {
  settableStatusSelections,
  encodeStatusSelection,
  type ApplyGateBlocker,
} from "@/lib/rules/campaign-status";
import { AnchoredMenu, MENU_ITEM, MENU_LABEL } from "@/components/ui";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<CampaignStatus, string> = Object.fromEntries(
  CAMPAIGN_STATUSES.map((s) => [s.value, s.label]),
) as Record<CampaignStatus, string>;

// Full recruiter-facing labels for the menu (the two "Active —" options).
const SELECTION_LABEL: Record<CampaignStatusSelection, string> = Object.fromEntries(
  CAMPAIGN_STATUS_SELECTIONS.map((s) => [s.value, s.label]),
) as Record<CampaignStatusSelection, string>;

/** Light-theme badge tone per status, matching the candidate StageChanger palette. */
function statusTone(status: CampaignStatus): string {
  switch (status) {
    case "active":
      return "text-[#047857] bg-[#ECFDF5] border-[#A7F3D0] hover:bg-[#D1FAE5]";
    case "paused":
      return "text-[#B45309] bg-[#FFFBEB] border-[#FDE68A] hover:bg-[#FEF3C7]";
    case "closed":
      return "text-[#B91C1C] bg-[#FEF2F2] border-[#FECACA] hover:bg-[#FEE2E2]";
    default:
      return "text-[#4B5563] bg-[#F3F4F6] border-[#E5E7EB] hover:bg-[#E5E7EB]";
  }
}

/** The dot carries the status when the pill is scanned rather than read. */
function statusDot(status: CampaignStatus): string {
  switch (status) {
    case "active":
      return "bg-[#059669]";
    case "paused":
      return "bg-[#D97706]";
    case "closed":
      return "bg-[#DC2626]";
    default:
      return "bg-[#9CA3AF]";
  }
}

export function CampaignStatusChanger({
  campaignId,
  currentStatus,
  acceptingApplications = true,
  applyBlocker = null,
}: {
  campaignId: string;
  currentStatus: CampaignStatus;
  /** The stored intake switch. Decides which of the five options is the
   *  campaign's *current* one, so the menu can leave it out. The intake switch
   *  itself is toggled from this menu or the campaign form. */
  acceptingApplications?: boolean;
  /** Which intake gate is shut, computed on the server against one clock.
   *  Decides what the badge *says*, which is not the same question: a passed
   *  deadline shuts the apply link without changing either stored field, so a
   *  badge derived from the status alone reads "Active" over a page telling
   *  candidates applications are closed. */
  applyBlocker?: ApplyGateBlocker | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Offer every status/intake option except the campaign's current one.
  const currentSelection = encodeStatusSelection(currentStatus, acceptingApplications);
  const options = settableStatusSelections(currentSelection);

  // The badge never claims to be open when it isn't. `not_active` needs no
  // suffix — "Paused" already says it — but the two gates that shut an *Active*
  // campaign's link have to be named, or the badge contradicts the apply page.
  const currentLabel =
    applyBlocker === "intake_closed"
      ? "Active — not accepting"
      : applyBlocker === "deadline_passed"
        ? "Active — deadline passed"
        : STATUS_LABEL[currentStatus];

  function pick(selection: CampaignStatusSelection) {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        await updateCampaignStatus(campaignId, selection);
        // revalidatePath in the action re-renders the page with the new status.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to change status");
      }
    });
  }

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !isPending && setOpen((o) => !o)}
        disabled={isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change campaign status"
        className={cn(
          "inline-flex min-h-8 items-center gap-[7px] rounded-full border px-2.5 text-xs font-semibold transition-colors duration-150",
          statusTone(currentStatus),
          isPending
            ? "cursor-default"
            : "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1",
        )}
      >
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(currentStatus))}
          aria-hidden="true"
        />
        {isPending ? "Saving…" : currentLabel}
        {!isPending && (
          <svg
            className={cn("w-3 h-3 transition-transform duration-200", open && "rotate-180")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="left"
      >
        <p className={MENU_LABEL}>Change status to</p>
        {options.map((selection) => (
          <button
            key={selection}
            type="button"
            role="menuitem"
            onClick={() => pick(selection)}
            className={MENU_ITEM}
          >
            {SELECTION_LABEL[selection]}
          </button>
        ))}
      </AnchoredMenu>

      {error && (
        <p className="absolute top-full left-0 mt-1 text-xs text-[#DC2626] whitespace-nowrap">
          {error}
        </p>
      )}
    </div>
  );
}
