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

/** The id a transcript turn must carry for `EvidenceExcerpt` to reach it. */
export function transcriptTurnId(prefix: string, index: number): string {
  return `${prefix}-turn-${index}`;
}

/** Tailwind for a turn that has been jumped to. Applied by both transcripts. */
export const TURN_TARGET_HIGHLIGHT =
  "[&:target]:border-[#4F46E5] [&:target]:bg-[#EEF2FF] [&:target]:ring-2 [&:target]:ring-[#4F46E5]/30 scroll-mt-24";

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
    return (
      <p className="mt-1 text-[11px] italic text-[#9CA3AF]">
        {zeroScored
          ? "No supporting quote was found in the transcript — this is why the score is zero."
          : "No linked excerpt — this score was recorded before evidence was captured."}
      </p>
    );
  }

  return (
    <figure className="mt-1.5 rounded-md border-l-2 border-[#C7D2FE] bg-[#F9FAFB] py-1 pl-2.5 pr-2">
      <blockquote className="text-[11px] leading-relaxed text-[#4B5563]">
        “{text}”
      </blockquote>
      {typeof turnIndex === "number" ? (
        <figcaption className="mt-0.5">
          <a
            href={`#${transcriptTurnId(anchorPrefix, turnIndex)}`}
            className="inline-flex cursor-pointer items-center gap-0.5 text-[10px] font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
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
        </figcaption>
      ) : (
        // Grounded but not pinnable: the quote was verified against the
        // candidate's speech as a whole, yet spans more than one utterance, so
        // there is no single turn to point at. Say so rather than link wrongly.
        <figcaption className="mt-0.5 text-[10px] text-[#9CA3AF]">
          Spans more than one answer — see the transcript below.
        </figcaption>
      )}
    </figure>
  );
}
