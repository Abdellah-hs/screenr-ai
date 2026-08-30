"use client";

import { cn } from "@/lib/utils";

/**
 * The controls the campaign editors share.
 *
 * Reviewers, SLA timers and interview availability are three lists of the same
 * shape — a titled block, an "Add …" button, rows of small fields and a remove
 * button — and they had drifted into three different sets of paddings, radii
 * and reds. One definition each, so a fix lands everywhere at once.
 */

/** A field inside a card: smaller than `FIELD_BASE`, same solid white. */
export const FIELD_SM =
  "w-full min-h-10 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] text-ink " +
  "outline-none transition-colors duration-150 placeholder:text-[#9CA3AF] " +
  "focus:border-primary focus:outline-[3px] focus:outline-primary/20";

export const LABEL_SM = "mb-[5px] block text-xs text-[#374151]";

/** The heading of one editor block — a peer of the card's other rows, not a page heading. */
export const EDITOR_TITLE = "text-[13px] font-semibold text-ink";

export const EDITOR_HEAD_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[#D1D5DB] bg-white px-3 " +
  "text-[13px] font-semibold text-[#374151] transition-colors duration-150 " +
  "hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Removing a row is destructive, so it is outlined-on-hover rather than filled:
 * a permanently red button in a list of six reads as six warnings.
 */
export function RemoveButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#9CA3AF]",
        "transition-colors duration-150 hover:bg-[#FEF2F2] hover:text-[#DC2626]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626]",
        className,
      )}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/** Native select arrows differ per platform; `appearance-none` plus this keeps one. */
export function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
