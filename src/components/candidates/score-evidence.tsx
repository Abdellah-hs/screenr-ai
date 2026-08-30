/**
 * The words behind a score (PRD 3.10.2, 3.4.4), shown inline and linked to the
 * transcript turn they came from.
 *
 * Shared by the AI interview and the voice screening because they are the same
 * promise: a manager must be able to get from a number to the sentence that
 * produced it, and to verify it *without* replaying the whole call. Rendering
 * the excerpt inline is what satisfies the second half — the jump link is for
 * reading it in context.
 *
 * No JavaScript. A plain fragment link scrolls, and `:target` on the turn does
 * the highlight, which keeps both transcripts server components and means the
 * link still works with a copied URL.
 */
import { cn } from "@/lib/utils";


/** The id a transcript turn must carry for `EvidenceExcerpt` to reach it. */
export function transcriptTurnId(prefix: string, index: number): string {
  return `${prefix}-turn-${index}`;
}

/** Tailwind for a turn that has been jumped to. Applied by both transcripts. */
export const TURN_TARGET_HIGHLIGHT =
  "[&:target]:border-[#4F46E5] [&:target]:bg-[#EEF2FF] [&:target]:ring-2 [&:target]:ring-[#4F46E5]/30 scroll-mt-24";

/**
 * The link from a quote back to the moment it was said, or the honest note
 * when there is no single moment to point at.
 *
 * No JavaScript: a plain fragment link scrolls and `:target` on the turn does
 * the highlight, so a copied URL still works.
 *
 * Shared because the same two variants — the arrow link and the "spans more
 * than one answer" line — were written out in `EvidenceExcerpt` and again by
 * hand in the screening evaluation panel, down to the SVG path.
 */
export function TranscriptJumpLink({
  anchorPrefix,
  turnIndex,
  className = "mt-1.5",
}: {
  anchorPrefix: string;
  turnIndex: number | null | undefined;
  className?: string;
}) {
  if (typeof turnIndex !== "number") {
    // Grounded but not pinnable: the quote was verified against the candidate's
    // speech as a whole, yet spans more than one utterance, so there is no
    // single turn to point at. Say so rather than link wrongly.
    return (
      <p className={cn(className, "text-[10px] text-[#9CA3AF]")}>
        Spans more than one answer — see the transcript.
      </p>
    );
  }

  return (
    <a
      href={`#${transcriptTurnId(anchorPrefix, turnIndex)}`}
      className={cn(
        className,
        "inline-flex cursor-pointer items-center gap-0.5 text-[11px] font-semibold text-primary transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      Jump to this moment
      <svg
        className="h-2.5 w-2.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </a>
  );
}

export function EvidenceExcerpt({
  quote,
  turnIndex,
  anchorPrefix,
  /** Why this dimension scored zero, when it did — shown instead of a quote. */
  zeroScored = false,
}: {
  quote: string | null | undefined;
  turnIndex: number | null | undefined;
  anchorPrefix: string;
  zeroScored?: boolean;
}) {
  const text = quote?.trim();

  if (!text) {
    // Three different absences, and collapsing them would be dishonest. A zero
    // means the scorer looked and found nothing — that is a finding. Anything
    // else means this score predates evidence capture (#148), which is not the
    // candidate's fault and must not read like one.
    // Dashed, and the same shape as a filled excerpt, so an absence reads as an
    // empty slot rather than as a line the layout forgot to draw.
    return (
      <p className="mt-2 rounded-r-lg border-l-2 border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-3.5 py-2.5 text-[11px] leading-[1.55] text-[#9CA3AF]">
        {zeroScored
          ? "No supporting quote was found in the transcript — this is why the score is zero."
          : "No linked excerpt — this score was recorded before evidence was captured."}
      </p>
    );
  }

  // The indigo edge, one step lighter than the 3px rail that wraps a score. The
  // words are the candidate's own; choosing them is the model's act, so the
  // attribution sits on the block rather than on a badge beside it.
  return (
    <figure className="mt-2 rounded-r-lg border-l-2 border-ai bg-ai-wash px-3.5 py-2.5">
      <blockquote className="text-[13px] leading-[1.65] text-[#374151]">
        “{text}”
      </blockquote>
      <figcaption className="mt-1.5">
        <TranscriptJumpLink anchorPrefix={anchorPrefix} turnIndex={turnIndex} className="" />
      </figcaption>
    </figure>
  );
}
