import type { ReactNode } from "react";
import Link from "next/link";
import { TIER_LABELS, type ScoreFactor, type ScreeningTier } from "@/lib/constants";
import { AiCaption, AiEyebrow, AiRail } from "./ai-attribution";
import { cn } from "@/lib/utils";

/**
 * The signature component of this product, at three sizes.
 *
 * The number and its "why" are one object. At every size the score is
 * physically attached to a 3px indigo rail, and at every size but the smallest
 * the rationale is on screen — you cannot read the figure without seeing whose
 * opinion it is. A bare integer in a column is the failure mode this exists to
 * prevent, because a number with no author reads as a fact.
 *
 * No size shows a weight. Weighting is derived from must-have/nice-to-have and
 * importance; exposing it would invite tuning the rubric until it agreed with
 * the answer the reader already wanted.
 */

const TIER_PILL: Record<ScreeningTier, string> = {
  strong: "bg-[#ECFDF5] text-[#047857]",
  moderate: "bg-[#FEF3C7] text-[#B45309]",
  weak: "bg-[#FEF2F2] text-[#DC2626]",
  no_match: "bg-[#FEE2E2] text-[#991B1B]",
  eligible: "bg-[#ECFDF5] text-[#047857]",
  ineligible: "bg-[#FEF2F2] text-[#DC2626]",
};

const TIER_PILL_BORDERED: Record<ScreeningTier, string> = {
  strong: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]",
  moderate: "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]",
  weak: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
  no_match: "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]",
  eligible: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]",
  ineligible: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
};

// ─── Size 1 · inline (table cell) ────────────────────────────────────────────

/**
 * Score, tier, and a 3px indigo tick — the smallest unit that is still honest.
 * The rationale is not here, which is why the whole thing is a link to where it
 * is rather than a decoration.
 */
export function ScoreInline({
  score,
  tier,
  className,
}: {
  /** Null for a candidate who failed a must-have: they are never ranked. */
  score: number | null;
  tier?: ScreeningTier | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // `shrink-0` because `overflow-hidden` is load-bearing here — it is
        // what clips the rail into the rounded corner — so a squeezed instance
        // does not wrap or ellipsise, it silently truncates the tier to a
        // half-word ("Eligib"). A verdict that renders as a fragment of itself
        // is worse than one that overflows its column visibly.
        "inline-flex w-max shrink-0 items-stretch overflow-hidden rounded-md border border-[#E5E7EB] bg-white",
        className,
      )}
    >
      <span className="w-[3px] shrink-0 bg-ai" aria-hidden="true" />
      <span className="inline-flex items-center gap-2 px-2.5 py-[5px]">
        <span className="text-sm font-semibold tabular-nums text-ink">{score}</span>
        {/* "/100" claims a grade. An evidence-scored CV's number is a ranking
            over the criteria — the `eligible` / `ineligible` tiers are the tell,
            since no other scorer produces them — so it is labelled as one here
            rather than sitting next to a denominator it does not have.
            The graded stages keep the denominator, which is true of them. */}
        <span className="text-[11px] text-[#9CA3AF]">
          {tier === "eligible" || tier === "ineligible" ? "rank" : "/100"}
        </span>
        {tier && (
          <span
            className={cn(
              "rounded-full px-[7px] py-0.5 text-[11px] font-semibold",
              TIER_PILL[tier],
            )}
          >
            {TIER_LABELS[tier]}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The absence of a score, said as a state rather than a dash.
 *
 * A dash in a score column is ambiguous between "not scored yet", "this stage
 * produces no score", and "the scoring failed" — three facts with three
 * different next actions. The caller names which one it is.
 */
export function ScoreAbsent({ children = "Not scored yet" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex w-max items-center gap-2 rounded-md border border-dashed border-[#E5E7EB] px-2.5 py-1.5 text-xs text-[#9CA3AF]">
      {children}
    </span>
  );
}

// ─── Size 2 · card (review panels, side rails) ───────────────────────────────

/**
 * Two lines of rationale, clamped, plus provenance and a link to the evidence.
 * The size for a rail or a review panel, where the score is context for a
 * decision being made elsewhere on the page.
 */
export function ScoreCard({
  label,
  score,
  tier,
  rationale,
  provenance,
  evidenceHref,
  evidenceLabel = "Evidence →",
}: {
  /** e.g. "CV score" — the stage, never a rollup. */
  label: string;
  score: number | null;
  tier?: ScreeningTier | null;
  rationale?: string | null;
  /** "claude-sonnet-4 · rubric v3 · 14 Aug" */
  provenance: string;
  evidenceHref?: string;
  evidenceLabel?: string;
}) {
  return (
    <AiRail>
      <div className="px-5 py-[18px]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <AiEyebrow>{label} · AI assessment</AiEyebrow>
          {tier && (
            <span
              className={cn(
                "rounded-full px-2.5 py-[3px] text-[11px] font-semibold",
                TIER_PILL[tier],
              )}
            >
              {TIER_LABELS[tier]}
            </span>
          )}
        </div>

        <div className="mb-2.5 flex items-baseline gap-2">
          <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-ink">
            {score}
          </span>
          <span className="text-sm text-[#9CA3AF]">/ 100</span>
        </div>

        {rationale && (
          <p className="mb-3 line-clamp-2 text-[13px] leading-[1.55] text-[#374151]">
            {rationale}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[#F3F4F6] pt-3">
          <span className="text-xs text-[#6B7280]">{provenance}</span>
          {evidenceHref && (
            <Link
              href={evidenceHref}
              className="text-[13px] font-semibold text-primary hover:underline"
            >
              {evidenceLabel}
            </Link>
          )}
        </div>
      </div>
    </AiRail>
  );
}

// ─── Size 3 · full section (candidate detail) ────────────────────────────────

/** How well one criterion was evidenced, as a word rather than only a bar. */
export type CriterionVerdict = "evidenced" | "partial" | "conflict";

const VERDICT_TONE: Record<CriterionVerdict, { bar: string; text: string; label: string }> =
  {
    evidenced: { bar: "bg-[#059669]", text: "text-[#047857]", label: "Evidenced" },
    partial: { bar: "bg-[#D97706]", text: "text-[#B45309]", label: "Partial" },
    conflict: { bar: "bg-[#DC2626]", text: "text-[#B91C1C]", label: "Conflict" },
  };

/**
 * Where a criterion's score falls into a word.
 *
 * Three bands rather than a gradient, because the bar is not the message — the
 * word beside it is, and colour is never allowed to carry meaning alone.
 */
export function criterionVerdict(score: number): CriterionVerdict {
  if (score >= 70) return "evidenced";
  if (score >= 40) return "partial";
  return "conflict";
}

/**
 * The full section: per-criterion breakdown, the fallibility line, and the
 * evidence links. The only size that shows criterion detail — and it still
 * shows no weights.
 */
export function ScoreSection({
  eyebrow,
  title,
  score,
  tier,
  rationale,
  factors = [],
  mandatoryNames = [],
  fallibility,
  provenance,
  links,
  lead = "score",
  scoreLabel,
  emptyScoreText = "Not scored",
}: {
  /** e.g. "Voice screening · AI assessment" */
  eyebrow: string;
  /** e.g. "Screening score" */
  title: string;
  score: number | null;
  tier?: ScreeningTier | null;
  rationale?: string | null;
  factors?: ScoreFactor[];
  /** Criterion names the rubric marks must-have, for the "· must-have" suffix. */
  mandatoryNames?: string[];
  /** The "an AI wrote this" sentence, which differs by stage. */
  fallibility?: string;
  provenance: string;
  links?: { label: string; href: string }[];
  /**
   * Which of the two results is the headline.
   *
   * `"score"` for a stage whose number is a graded 0-100 over everything that
   * was assessed — the screening and interview scores are exactly that, and the
   * big figure is the right thing to lead with.
   *
   * `"verdict"` for the resume stage, where the two results answer different
   * questions and the number is the *lesser* of them: a ranking that orders the
   * candidates who already passed. Shown at 4xl beside an "Eligible" pill it
   * read as a single self-contradicting grade — 13 out of 100, and yet passing.
   * The gate is the decision; the ranking only sorts its survivors.
   */
  lead?: "score" | "verdict";
  /** The word before the number when it is not the headline, e.g. "Ranking". */
  scoreLabel?: string;
  /** Shown in place of a null score — never a bare "/ 100" with nothing in it. */
  emptyScoreText?: string;
}) {
  const mandatory = new Set(mandatoryNames);

  return (
    <AiRail>
      <div className="min-w-0">
        <div className="border-b border-[#F3F4F6] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <AiEyebrow>
                {/* Heroicons cpu-chip, deliberately not a sparkle: this is a
                    machine reading a document, not magic happening. */}
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
                  />
                </svg>
                {eyebrow}
              </AiEyebrow>
              <h3 className="mt-2 font-heading text-lg font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h3>
            </div>

            <div className="w-[224px] shrink-0 text-right">
              {lead === "verdict" && tier ? (
                <>
                  {/* The gate first, at the size the decision deserves. */}
                  <span
                    className={cn(
                      "inline-block rounded-full border px-3.5 py-1.5 text-base font-semibold",
                      TIER_PILL_BORDERED[tier],
                    )}
                  >
                    {TIER_LABELS[tier]}
                  </span>
                  <div className="mt-2.5 flex items-baseline justify-end gap-1.5">
                    {scoreLabel && (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF]">
                        {scoreLabel}
                      </span>
                    )}
                    {score != null ? (
                      <>
                        <span className="text-xl font-semibold tabular-nums text-ink">
                          {score}
                        </span>
                        <span className="text-[13px] text-[#9CA3AF]">/ 100</span>
                      </>
                    ) : (
                      <span className="text-[13px] font-medium text-[#9CA3AF]">
                        {emptyScoreText}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-end gap-1.5">
                    {score != null ? (
                      <>
                        <span className="text-4xl font-semibold tracking-[-0.025em] tabular-nums text-ink">
                          {score}
                        </span>
                        <span className="text-[15px] text-[#9CA3AF]">/ 100</span>
                      </>
                    ) : (
                      // A null score used to render "/ 100" with nothing before
                      // it, which reads as a rendering failure rather than a
                      // state. Every absence on this page is named.
                      <span className="text-lg font-medium text-[#9CA3AF]">
                        {emptyScoreText}
                      </span>
                    )}
                  </div>
                  {tier && (
                    <span
                      className={cn(
                        "mt-1.5 inline-block rounded-full border px-2.5 py-1 text-xs font-semibold",
                        TIER_PILL_BORDERED[tier],
                      )}
                    >
                      {TIER_LABELS[tier]}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {rationale && (
          <div className="border-b border-[#F3F4F6] px-6 py-5">
            <p className="text-sm leading-[1.6] text-[#374151] text-pretty">{rationale}</p>
          </div>
        )}

        {factors.length > 0 && (
          <div className="border-b border-[#F3F4F6] px-6 py-[18px]">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
              By criterion
            </p>
            <div className="flex flex-col gap-2.5">
              {factors.map((factor) => {
                const verdict = criterionVerdict(factor.score);
                const tone = VERDICT_TONE[verdict];
                return (
                  <div
                    key={factor.name}
                    className="grid items-center gap-3.5 [grid-template-columns:1fr_84px_118px]"
                  >
                    <span className="min-w-0 text-[13px] text-ink">
                      {factor.name}
                      <span className="text-[#6B7280]">
                        {mandatory.has(factor.name) ? " · must-have" : " · nice-to-have"}
                      </span>
                    </span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#F3F4F6]">
                      <div
                        className={cn("h-full rounded-full", tone.bar)}
                        style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }}
                      />
                    </div>
                    <span className={cn("text-xs font-semibold", tone.text)}>
                      {tone.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* The footer is the point of the whole component: the sentence that
            says a model wrote this, that it can be wrong, and that it moved
            nobody — sitting on the indigo wash so it reads as part of the
            score rather than a disclaimer bolted to the bottom. */}
        <AiCaption fallibility={fallibility} at={provenance} className="py-4">
          {links?.length ? links.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              className="text-primary hover:underline"
            >
              {link.label}
            </Link>
          )) : undefined}
        </AiCaption>
      </div>
    </AiRail>
  );
}
