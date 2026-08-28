import Link from "next/link";
import {
  candidateDetailHref,
  type EvidenceCaptionTone,
  type EvidenceNavMeter,
  type EvidenceNavNode,
  type EvidenceView,
} from "@/lib/candidates/evidence-nav";
import { cn } from "@/lib/utils";

/** Every tile and tab is a link; none of them may be invisible to a keyboard. */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";

/**
 * The evidence file, as a row of stages rather than a column beside one.
 *
 * Each tile replaces the panel below it, so the thing being read is the only
 * thing rendered. That much is unchanged from the vertical rail this replaced —
 * the switch was right, its orientation was not. Three things went wrong when
 * it stood in a 222px column down the left:
 *
 * 1. **The column had nothing else to do.** Seven short rows and a caption ran
 *    out after ~250px against evidence panels that run to thousands, so most of
 *    a full-height column was air, and the card at the top of it read as a box
 *    that had been cut off rather than as an index.
 * 2. **It argued with its own caption.** Three numbers stacked vertically is
 *    the exact shape that invites someone to average them, which is why the
 *    rail had to print "there is no combined figure" underneath. Three tiles in
 *    a row are three separate readings on their face; the sentence now confirms
 *    the layout instead of correcting it.
 * 3. **It taxed the evidence to pay for itself.** The panel lost 250px of width
 *    permanently — to a nav that is used once per visit — and that width is
 *    what a criterion row, its meter, its level and its quote actually need.
 *
 * Stages read left to right because that is the order they happen in, which the
 * pipeline bar, the funnel and the candidate table all already say. Proctoring
 * is **not** in the row: it is a second reading of one sitting, not a fourth
 * stage, so it heads the panel instead — see `EvidenceStageSwitch`. History sits
 * apart from the tiles entirely: its number counts events, not quality, and
 * flush with three scores it reads as a fourth one.
 *
 * It carries no heading of its own. It had one — an "EVIDENCE FILE" eyebrow —
 * back when that row also had to hold the History count off to its right. With
 * History moved up to the tabs the eyebrow was left repeating, word for word,
 * the tab selected directly above it. The `aria-label` still names the region
 * for anyone who cannot see where they are.
 *
 * A server component: the selection arrives as a search param, so there is no
 * state here to hydrate and no scroll listener to keep in step with it.
 */
export function EvidenceNav({
  tree,
  active,
  basePath,
}: {
  tree: EvidenceNavNode[];
  active: EvidenceView;
  /** The candidate's own path; each tile adds its own selection to it. */
  basePath: string;
}) {
  // Every link must name the tab as well as the view. The strip only renders
  // inside the evidence tab, so a link that omits it sends the reader back to
  // the Parsed CV instead of switching the panel below them.
  const href = (view: EvidenceView) => candidateDetailHref(basePath, "evidence", view);

  return (
    <nav aria-label="Evidence file" className="flex flex-col gap-2.5">
      {/* One per row on a narrow window. Three tiles at 360px would truncate
          both the label and the caption, and a stage whose name is cut in half
          is worse than a stage that costs a scroll. */}
      <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {tree.map((node) => (
          <li key={node.view} className="min-w-0">
            <StageTile
              href={href(node.view)}
              label={node.label}
              meta={node.meta}
              caption={node.caption}
              captionTone={node.captionTone}
              meter={node.meter}
              quiet={node.quiet}
              selected={node.view === active}
              // A stage whose proctoring report is open is still the stage you
              // are reading — named, but not competing for the highlight.
              withinSelection={node.children.some((c) => c.view === active)}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The caption's weight, and the one case where it is allowed a colour. */
const CAPTION_TONE: Record<EvidenceCaptionTone, string> = {
  reading: "text-[#6B7280]",
  pending: "text-[#6B7280]",
  // The only coloured caption in the strip. A lapse is the one absence that
  // needs somebody today, and it read exactly like "Awaiting the call" until it
  // was given the amber every other stalled thing in the product wears.
  lapsed: "text-[#B45309]",
  upcoming: "text-[#C4C9D2]",
};

/**
 * One stage: its name, its number, where that number sits against the bar, and
 * what it was a reading of.
 *
 * The score is baseline-aligned with the label rather than centred in the tile,
 * so the three figures sit on one line across the row and can be compared at a
 * glance without any of them being made to look like a total.
 */
function StageTile({
  href,
  label,
  meta,
  caption,
  captionTone,
  meter,
  quiet,
  selected,
  withinSelection,
}: {
  href: string;
  label: string;
  meta: string | null;
  caption: string | null;
  captionTone: EvidenceCaptionTone;
  meter: EvidenceNavMeter | null;
  /** No score on file: the figure is a dash, rendered so it cannot read as 0. */
  quiet: boolean;
  selected: boolean;
  /** A parent whose proctoring report is open: named, but not highlighted. */
  withinSelection: boolean;
}) {
  const current = selected || withinSelection;

  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex h-full flex-col gap-1.5 rounded-xl border px-3.5 py-3 transition-colors duration-150",
        FOCUS_RING,
        current
          ? "border-ink bg-white shadow-sm"
          : cn(
              "hover:border-[#D1D5DB] hover:bg-white",
              // Dashed while the pipeline has not arrived: a box waiting to be
              // filled in, which is what the stage is. Solid the moment there
              // is anything to say about it, scored or not.
              captionTone === "upcoming"
                ? "border-dashed border-[#E5E7EB] bg-transparent"
                : "border-[#E5E7EB] bg-[#FAFAFA]",
            ),
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "truncate text-[13px]",
            current ? "font-semibold text-ink" : "font-medium text-[#4B5563]",
          )}
        >
          {label}
        </span>
        {meta && (
          <span
            className={cn(
              "shrink-0 font-semibold leading-none tabular-nums",
              // The placeholder is set smaller than a real figure on purpose: an
              // em dash at 20px is a horizontal rule, and stacked above the
              // empty meter track it gave every unscored tile two competing
              // lines and no number.
              quiet ? "text-[15px] text-[#D1D5DB]" : "text-[20px] text-ink",
            )}
          >
            {meta}
          </span>
        )}
      </span>

      <StageMeter meter={meter} />

      {caption && (
        <span className={cn("truncate text-[11px] leading-[1.5]", CAPTION_TONE[captionTone])}>
          {caption}
        </span>
      )}
    </Link>
  );
}

/**
 * Where the stage's number sits against the bar the campaign set for it.
 *
 * A bare `59` is unreadable without remembering this campaign's threshold, and
 * the threshold is per-campaign and per-stage. The colours are not decoration
 * and are not interchangeable — they are the same ones the evaluation panels
 * use, for the same reasons:
 *
 * - **Red** below `resume_threshold`: an eligible CV under the bar is rejected.
 * - **Amber** below `screening_threshold`: since 2026-08-22 it rests at
 *   `screening_scored` for a person. Nobody is rejected, so nothing here is
 *   allowed to look like a failure.
 * - **No tick at all** on the interview, which sets no bar and never rejects.
 *   The absence is the point; a tick drawn there would name a rule that does
 *   not exist.
 *
 * Unscored stages keep the empty track so the captions below stay aligned
 * across the row — but with no fill and no tick, because a meter pinned at the
 * left end is a picture of "how close they came", and an unscored stage has no
 * such story to tell.
 *
 * `aria-hidden`: the number is beside it and the threshold is narrated by the
 * `sr-only` sentence, so a tick mark has nothing to add that can be said aloud.
 */
function StageMeter({ meter }: { meter: EvidenceNavMeter | null }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  return (
    <>
      <span aria-hidden="true" className="relative block h-[3px] rounded-full bg-[#F0F1F4]">
        {meter && (
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              meter.clears === null
                ? "bg-[#9CA3AF]"
                : meter.clears
                  ? "bg-[#059669]"
                  : meter.miss === "holds"
                    ? "bg-[#D97706]"
                    : "bg-[#DC2626]",
            )}
            style={{ width: `${clamp(meter.score)}%` }}
          />
        )}
        {meter?.threshold != null && (
          <span
            className="absolute top-[-2.5px] h-2 w-[2px] rounded-full bg-ink"
            style={{
              left: `${clamp(meter.threshold)}%`,
              transform: "translateX(-50%)",
            }}
          />
        )}
      </span>

      {meter && (
        <span className="sr-only">
          {meter.score} out of 100.{" "}
          {meter.threshold == null
            ? "This stage sets no threshold."
            : `${meter.clears ? "At or above" : "Below"} your threshold of ${meter.threshold}.`}
        </span>
      )}
    </>
  );
}

/**
 * Which reading of the open stage the panel is showing — the call, or the
 * watching over it.
 *
 * It heads the **panel**, not the strip, and that placement is the whole point.
 * The strip answers "which stage"; this answers "which reading of that stage",
 * and a control belongs with the thing it changes. Hung off the bottom of its
 * tile instead it was a grey slab floating in one column of three, detached
 * from the tile above it and from the panel below it, with dead space either
 * side — a drawer nothing had opened.
 *
 * Flat tabs, deliberately, and the same shape as the page's own tab bar. The
 * page already nests two levels of choice above this one; a third box stacked
 * under three boxes was one container too many, and an underline adds a control
 * without adding an object.
 *
 * Renders nothing at all unless the open stage has a second reading, so a CV —
 * which has only itself — never shows a switch with one tab in it.
 */
export function EvidenceStageSwitch({
  tree,
  active,
  basePath,
}: {
  tree: EvidenceNavNode[];
  active: EvidenceView;
  basePath: string;
}) {
  const openStage = tree.find(
    (node) => node.view === active || node.children.some((c) => c.view === active),
  );
  if (!openStage || openStage.children.length === 0) return null;

  const href = (view: EvidenceView) => candidateDetailHref(basePath, "evidence", view);
  const tabs = [
    { view: openStage.view, label: openStage.selfLabel ?? openStage.label, quiet: false },
    ...openStage.children.map((c) => ({ view: c.view, label: c.label, quiet: c.quiet })),
  ];

  return (
    <nav
      aria-label={`${openStage.label} readings`}
      className="flex items-center gap-5 border-b border-[#E5E7EB]"
    >
      {tabs.map((tab) => {
        const selected = tab.view === active;
        return (
          <Link
            key={tab.view}
            href={href(tab.view)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pb-2 text-xs transition-colors duration-150",
              FOCUS_RING,
              selected
                ? "border-ink font-semibold text-ink"
                : cn(
                    "border-transparent font-medium hover:text-ink",
                    // Nothing was captured behind it: rendered light, still
                    // reachable, because "never watched" is itself a reading.
                    tab.quiet ? "text-[#9CA3AF]" : "text-[#6B7280]",
                  ),
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
