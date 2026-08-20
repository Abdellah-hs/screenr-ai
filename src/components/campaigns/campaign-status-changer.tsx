"use client";

import { useRef, useState, useTransition } from "react";
import { updateCampaignStatus } from "@/lib/actions/campaigns";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_SELECTIONS,
  type CampaignStatus,
  type CampaignStatusSelection,
} from "@/lib/constants";
import { settableStatusSelections, encodeStatusSelection } from "@/lib/rules/campaign-status";
import { AnchoredMenu } from "@/components/ui";
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
      return "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]";
    case "paused":
      return "text-[#B45309] bg-[#FFFBEB] border-[#FDE68A]";
    case "closed":
      return "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]";
    default:
      return "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]";
  }
}

export function CampaignStatusChanger({
  campaignId,
  currentStatus,
  acceptingApplications = true,
}: {
  campaignId: string;
  currentStatus: CampaignStatus;
  /** When active + false, the badge reads "not accepting" instead of "Active".
   *  The intake switch itself is toggled from the campaign form, not here. */
  acceptingApplications?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Offer every status/intake option except the campaign's current one.
  const currentSelection = encodeStatusSelection(currentStatus, acceptingApplications);
  const options = settableStatusSelections(currentSelection);

  // An active campaign with intake switched off reads as "not accepting" so the
  // badge never claims it's open when it isn't.
  const currentLabel =
    currentStatus === "active" && !acceptingApplications
      ? "Active — not accepting"
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
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium border rounded-md transition-colors duration-150",
          statusTone(currentStatus),
          isPending
            ? "cursor-default"
            : "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1",
        )}
      >
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
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Change status to
        </p>
        {options.map((selection) => (
          <button
            key={selection}
            type="button"
            role="menuitem"
            onClick={() => pick(selection)}
            className="w-full text-left px-3 py-1.5 text-xs text-[#4B5563] cursor-pointer transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:bg-[#F9FAFB]"
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
