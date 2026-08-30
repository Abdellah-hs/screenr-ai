import type { EvidenceLevel } from "@/lib/scoring/evidence-levels";
import { EVIDENCE_LEVEL_SCORE } from "@/lib/scoring/evidence-levels";
import { cn } from "@/lib/utils";

/**
 * How an evidence level is drawn — shared by the CV and the voice screening.
 *
 * The ladder itself is shared on purpose (`src/lib/scoring/evidence-levels.ts`):
 * if a `strong` reading of a CV and a `strong` reading of a spoken answer ever
 * scored differently, "strong" would stop meaning anything. This file is the
 * same commitment in pixels — a rung looks like a rung wherever it is read, so
 * a recruiter comparing two stage scores is looking at one ruler.
 *
 * What each level *means* is deliberately NOT shared: a CV proves a skill by
 * listing a role and a duration, an answer proves it by what the candidate can
 * say about the work when asked. So every component here takes its definitions
 * as an argument and never reaches for a stage's wording itself.
 */

/**
 * Weakest first — the order the ladder is read in, and the order the score
 * table is written in. Taken from that table's own keys so a level added to the
 * ladder appears here without anyone remembering to add it twice.
 */
export const EVIDENCE_LEVEL_ORDER = Object.keys(EVIDENCE_LEVEL_SCORE) as EvidenceLevel[];

export const LEVEL_LABELS: Record<EvidenceLevel, string> = {
  not_present: "Not present",
  unclear: "Unclear",
  weak: "Weak",
  partial: "Partial",
  strong: "Strong",
  very_strong: "Very strong",
};

/**
 * Colour is never the only signal: every row that uses these also carries the
 * level word, the numeric score, and the rung the meter filled to.
 */
export const LEVEL_STYLES: Record<EvidenceLevel, string> = {
  not_present: "bg-[#FEE2E2] text-[#991B1B]",
  unclear: "bg-[#F3F4F6] text-[#4B5563]",
  weak: "bg-[#FEF3C7] text-[#92400E]",
  partial: "bg-[#FEF3C7] text-[#92400E]",
  strong: "bg-[#ECFDF5] text-[#047857]",
  very_strong: "bg-[#ECFDF5] text-[#047857]",
};

/** The solid form of the tints above, for the filled rungs of the meter. */
export const LEVEL_FILL: Record<EvidenceLevel, string> = {
  not_present: "bg-[#EF4444]",
  unclear: "bg-[#9CA3AF]",
  weak: "bg-[#F59E0B]",
  partial: "bg-[#F59E0B]",
  strong: "bg-[#059669]",
  very_strong: "bg-[#059669]",
};

// ─── The shell every evidence card shares ────────────────────────────────────

export const CARD = "rounded-xl border border-[#E5E7EB] bg-white";

export const CARD_HEADER =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[#F3F4F6] px-5 py-3.5";

/** `font-sans` because the base layer puts every h1–h6 in the display serif. */
export const CARD_EYEBROW =
  "flex items-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]";

/** The strip of chrome under a card header that explains the card's own rule. */
export const CARD_NOTE =
  "border-b border-[#F3F4F6] bg-[#FAFAFA] px-5 py-3 text-xs leading-[1.6] text-[#6B7280]";

export const PASS_PILL = "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]";
export const FAIL_PILL = "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]";
/** For a bar that is missed without anyone being rejected — the screening one. */
export const HOLD_PILL = "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]";

export const PILL = "inline-flex rounded-full border px-2.5 py-[3px] text-[11px] font-semibold";

/** The level pill's shared chrome. The chip adds hover/focus; the ladder does not. */
export const LEVEL_PILL_BASE = "rounded-full px-2 py-[3px] text-[11px] font-semibold";

/** A 0-100 score as a track percentage. Three copies of this had accumulated. */
export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Heroicons outline, one path each — no sparkles, nothing decorative. */
export const HEADER_ICON = {
  /** shield-check — a gate. */
  requirements:
    "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  /** plus-circle — assessed on top of the requirements. */
  also: "M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  /** chart-bar — where this candidate sits against a bar. */
  ranking:
    "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z",
  /** microphone — the spoken call itself. */
  call: "M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z",
  /** question-mark-circle — what the call went looking for. */
  questions:
    "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z",
  /** squares-2x2 — the rubric, as a set of dimensions. */
  rubric:
    "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z",
} as const;

export function HeaderIcon({ d }: { d: string }) {
  return (
    <svg
      className="h-[15px] w-[15px] text-[#9CA3AF]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// ─── The ladder, drawn ───────────────────────────────────────────────────────

/** Segment width + gap, in px. The gate tick is placed off the same grid. */
const RUNG_STEP = 12;

/**
 * Which rung of the six-step ladder this landed on, and — where a stage has a
 * gate — where the pass mark sits.
 *
 * Six discrete segments rather than a continuous bar, because that is what the
 * system actually does: the model picks a rung and every number downstream is a
 * consequence of that pick. A smooth bar would draw a precision the scoring does
 * not have, and would read as a contribution to a total — the compensating
 * arithmetic the priority model exists to refuse.
 *
 * Purely a redrawing of the level word and the number beside it, so it is hidden
 * from assistive tech rather than narrated a third time. Its whole job is
 * comparison down a column: five criteria as five numbers have to be read one at
 * a time; as five meters they are one glance.
 */
export function RungMeter({
  level,
  gateLevel = null,
  className,
}: {
  level: EvidenceLevel;
  /** The cheapest rung that clears the gate. Null on a stage that has no gate. */
  gateLevel?: EvidenceLevel | null;
  /** Spacing for the caller's layout. The meter itself never varies. */
  className?: string;
}) {
  const reached = EVIDENCE_LEVEL_ORDER.indexOf(level);
  const gateIndex = gateLevel ? EVIDENCE_LEVEL_ORDER.indexOf(gateLevel) : -1;

  return (
    <span
      aria-hidden="true"
      className={cn("relative hidden items-center gap-[3px] sm:flex", className)}
    >
      {EVIDENCE_LEVEL_ORDER.map((rung, i) => (
        <span
          key={rung}
          className={cn(
            "h-[7px] w-[9px] rounded-[2px]",
            i <= reached ? LEVEL_FILL[level] : "bg-[#EDEFF2]",
          )}
        />
      ))}
      {gateIndex > 0 && (
        <span
          className="absolute top-[-3.5px] h-[14px] w-[1.5px] rounded-full bg-[#111827]"
          style={{ left: `${gateIndex * RUNG_STEP - 2}px` }}
        />
      )}
    </span>
  );
}

/**
 * The level word, with its definition attached.
 *
 * CSS-only: these render on the server and a tooltip is not worth a client
 * boundary. `opacity-0` rather than `hidden` on purpose — an opacity-0 node
 * stays in the accessibility tree, so a screen reader still gets the definition
 * that a sighted reader gets by hovering. `tabIndex` makes it reachable by
 * keyboard, the dotted underline is what says there is something to reach for,
 * and the full ladder at the foot of the block is the fallback on touch, where
 * there is no hover to give.
 *
 * The definition is a prop, never a lookup: the resume and the screening ladder
 * share their rungs and score exactly the same, and mean different things.
 */
export function LevelChip({
  level,
  definition,
}: {
  level: EvidenceLevel;
  definition: string;
}) {
  return (
    <span
      tabIndex={0}
      className={cn(
        LEVEL_PILL_BASE,
        "group relative inline-flex min-w-[84px] cursor-help items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        LEVEL_STYLES[level],
      )}
    >
      <span className="underline decoration-dotted decoration-1 underline-offset-[3px] opacity-90">
        {LEVEL_LABELS[level]}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-20 w-[min(20rem,72vw)] rounded-lg border border-[#E5E7EB] bg-white p-3 text-left text-[11px] font-normal leading-[1.6] text-[#4B5563] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100"
      >
        <span className="font-semibold text-ink">{LEVEL_LABELS[level]}</span>
        <span className="text-[#9CA3AF]"> · scores {EVIDENCE_LEVEL_SCORE[level]}</span>
        <br />
        {definition}
      </span>
    </span>
  );
}

/**
 * The whole ladder, collapsed.
 *
 * A row's own level is explained on its chip, which answers "why this level" but
 * never "how far off was it" — for that you need the rungs either side and what
 * each is worth. Closed by default because it is reference, not part of reading
 * the result; it is also the fallback on touch, where nothing hovers.
 */
export function EvidenceLadder({
  definitions,
  footnote,
}: {
  definitions: Record<EvidenceLevel, string>;
  /** What this stage has to admit about how its levels were chosen. Optional:
   *  a stage may show the ladder without the note. */
  footnote?: string;
}) {
  return (
    <details className="group rounded-xl border border-[#E5E7EB] bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-xs font-medium text-[#4B5563] transition-colors duration-150 hover:text-ink">
        <svg
          className="h-3.5 w-3.5 text-[#9CA3AF] transition-transform duration-150 group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        How evidence levels are scored
      </summary>
      <div className="border-t border-[#F3F4F6] px-5 py-3.5">
        <ul className="space-y-2">
          {EVIDENCE_LEVEL_ORDER.map((level) => (
            <li key={level} className="flex items-start gap-3 text-xs leading-[1.6]">
              {/* Literally the meter the rows use — the legend and a row must
                  be one object rather than two conventions to learn, and that
                  is only guaranteed if it is the same component. A row keyed on
                  `level` fills to exactly `i`, which is why no index is passed. */}
              <RungMeter level={level} className="mt-[5px]" />
              <span
                className={cn(
                  LEVEL_PILL_BASE,
                  "inline-flex h-fit w-[84px] shrink-0 justify-center",
                  LEVEL_STYLES[level],
                )}
              >
                {LEVEL_LABELS[level]}
              </span>
              <span className="min-w-0 flex-1 text-[#6B7280]">{definitions[level]}</span>
              <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-ink">
                {EVIDENCE_LEVEL_SCORE[level]}
              </span>
            </li>
          ))}
        </ul>
        {footnote && (
          <p className="mt-3 border-t border-[#F3F4F6] pt-2.5 text-[11px] leading-[1.6] text-[#9CA3AF]">
            {footnote}
          </p>
        )}
      </div>
    </details>
  );
}

// ─── Evidence blocks ─────────────────────────────────────────────────────────

/**
 * One piece of evidence: where it came from, what was said, and why it counts.
 *
 * The indigo edge is one step lighter than the 3px rail that wraps the score
 * above. The quote is the candidate's own words — from their CV or their mouth;
 * picking it and explaining it is the model's act, so the attribution belongs on
 * the block rather than on a badge.
 */
export function EvidenceBlock({
  eyebrow,
  quote,
  explanation,
  children,
}: {
  /** Where it was found — a CV section, or the speaker and turn. */
  eyebrow: string;
  quote: string;
  explanation?: string | null;
  /** A jump link, where the quote can be pinned to a moment. */
  children?: React.ReactNode;
}) {
  return (
    <figure className="rounded-r-lg border-l-2 border-ai bg-ai-wash px-3.5 py-2.5">
      <figcaption className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9CA3AF]">
        {eyebrow}
      </figcaption>
      <blockquote className="mt-1 text-[13px] leading-[1.65] text-[#374151]">
        “{quote}”
      </blockquote>
      {explanation && (
        <p className="mt-1.5 text-[11px] leading-[1.55] text-[#6B7280]">{explanation}</p>
      )}
      {children}
    </figure>
  );
}

/**
 * A slot with nothing in it.
 *
 * Dashed, and the same shape as an evidence block, so an absence reads as an
 * empty slot rather than as a line the layout forgot to draw.
 */
export function EvidenceAbsence({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-r-lg border-l-2 border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-3.5 py-2.5 text-xs leading-[1.55] text-[#9CA3AF]">
      {children}
    </p>
  );
}

/**
 * A reason to read the score below differently, sitting above the breakdown.
 *
 * One component for both spoken stages, because they sit on the same candidate
 * page one under the other — the screening's "we lost an answer" notice and the
 * interview's "this covered part of the rubric" notice are the same object, and
 * the amber must not drift between them. It is the same argument `ThresholdCard`
 * is built on.
 *
 * The shape is fixed at three parts because the third one is the point: a
 * caveat that states a doubt and stops has told a recruiter their number may be
 * wrong and given them nothing to do about it. `remedy` is where "read the
 * transcript" or "this is not a verdict on the candidate" goes, and it is
 * required rather than optional so it cannot be quietly left off.
 */
export function ScoreCaveatNotice({
  heading,
  children,
  remedy,
}: {
  heading: string;
  /** What happened, and what it does to the number below. */
  children: React.ReactNode;
  /** What to do about it. Never "reject on this score". */
  remedy: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-5 py-4">
      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#92400E]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
        {heading}
      </h4>
      <p className="mt-2 max-w-[68ch] text-xs leading-[1.6] text-[#92400E]">{children}</p>
      <p className="mt-2 max-w-[68ch] text-xs leading-[1.6] text-[#B45309]">{remedy}</p>
    </section>
  );
}

/**
 * A dimension the model claimed more for than survived verification.
 *
 * `reported_evidence_level` is stored exactly so this is legible: a verified
 * `partial` and a `strong` that was knocked down to `partial` because its quote
 * could not be found are the same number and very different readings.
 *
 * One component for both spoken stages, like `ScoreCaveatNotice` above it and
 * for the same reason — this sentence states the never-award-on-an-unverified-
 * quote rule, and a rule written twice is one that eventually says two things.
 * It takes the two levels rather than a dimension so neither stage's row type
 * has to reach the shared kit.
 */
export function DowngradeNote({
  level,
  reportedLevel,
}: {
  level: EvidenceLevel;
  /** What the model claimed, before quote verification lowered it. */
  reportedLevel: EvidenceLevel;
}) {
  if (reportedLevel === level) return null;

  return (
    <p className="mt-2.5 rounded-lg bg-[#FFFBEB] px-3 py-2 text-xs leading-[1.6] text-[#92400E]">
      <span className="font-semibold">
        Lowered from {LEVEL_LABELS[reportedLevel].toLowerCase()}.
      </span>{" "}
      The model read this dimension higher, but its quote could not be found in the
      candidate&rsquo;s own speech. Credit is never awarded on an unverified quote.
    </p>
  );
}

/**
 * A stage score against the bar the campaign set for it.
 *
 * The threshold is chosen in the wizard and then never shown again, so the only
 * bar visible on a scored candidate was the must-have gate — which is not the
 * one the recruiter picked. "59 · threshold 70" states a gap without giving its
 * size; a tick on a track answers "how far off?" in one glance and the pill
 * puts a number on it.
 *
 * One component for both stages, because they sit on the same page one above
 * the other. `miss` is the only thing that separates them, and it is the thing
 * that actually differs: below the resume bar a candidate is REJECTED, below
 * the screening bar they are HELD for a person. Red and amber say which.
 */
export function ThresholdCard({
  label,
  score,
  threshold,
  miss,
  children,
}: {
  label: string;
  score: number;
  threshold: number;
  /** What falling short of the bar does to the candidate at this stage. */
  miss: "rejects" | "holds";
  /** The stage's own footnote, under the meter. */
  children?: React.ReactNode;
}) {
  const clears = score >= threshold;
  const rejects = miss === "rejects";

  return (
    <section className={CARD}>
      <div className={CARD_HEADER}>
        <h4 className={CARD_EYEBROW}>
          <HeaderIcon d={HEADER_ICON.ranking} />
          {label}
        </h4>
        <span className={cn(PILL, clears ? PASS_PILL : rejects ? FAIL_PILL : HOLD_PILL)}>
          {score === threshold
            ? "Exactly on your threshold"
            : `${Math.abs(score - threshold)} ${clears ? "above" : "below"} your threshold`}
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[32px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-ink">
            {score}
          </span>
          <span className="text-sm text-[#9CA3AF]">/ 100</span>
        </div>

        {/* Decoration for a fact the pill and the figure already state, so the
            whole meter is hidden from assistive tech rather than narrated a
            third time with no way to say what a tick mark is. */}
        <div aria-hidden="true" className="relative mb-6 mt-4 h-2 rounded-full bg-[#F3F4F6]">
          <div
            className={cn(
              "h-full rounded-full",
              clears ? "bg-[#059669]" : rejects ? "bg-[#DC2626]" : "bg-[#D97706]",
            )}
            style={{ width: `${clampScore(score)}%` }}
          />
          <span
            className="absolute top-[-4px] h-4 w-[2px] rounded-full bg-[#111827]"
            style={{ left: `${clampScore(threshold)}%`, transform: "translateX(-50%)" }}
          />
          <span
            className="absolute top-[15px] whitespace-nowrap text-[10px] font-medium tabular-nums text-[#6B7280]"
            style={{ left: `${clampScore(threshold)}%`, transform: "translateX(-50%)" }}
          >
            threshold {threshold}
          </span>
        </div>

        {children}
      </div>
    </section>
  );
}
