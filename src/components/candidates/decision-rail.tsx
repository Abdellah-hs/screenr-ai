import type { ReactNode } from "react";
import Link from "next/link";
import type { ApplicationState, CandidateScore } from "@/lib/constants";
import { decisionPrompt } from "@/lib/candidates/decision-prompt";
import { stageScoreRows, type StageScoreRow } from "@/lib/candidates/detail-header";
import { cn } from "@/lib/utils";

/** The rail's panels are all the same box. */
const PANEL =
  "rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

const EYEBROW =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]";

const TIER_PILL: Record<string, string> = {
  strong: "bg-[#ECFDF5] text-[#047857]",
  moderate: "bg-[#FEF3C7] text-[#B45309]",
  weak: "bg-[#FEF2F2] text-[#DC2626]",
  no_match: "bg-[#FEE2E2] text-[#991B1B]",
};

/** The rail's tier pill is shorter than the table's — "Potential", not
 *  "Potential Match" — because it sits beside a number in 352px. */
const SHORT_TIER: Record<string, string> = {
  strong: "Strong",
  moderate: "Potential",
  weak: "Weak",
  no_match: "No match",
};

/**
 * The three stage scores, pinned, and nothing that adds them up.
 *
 * Three numbers in a column is exactly the shape that invites an average, so
 * the header says outright that there is no combined figure. Each row carries
 * its own indigo rail: these are three separate models reading three separate
 * pieces of evidence against three separate rubrics, and the PRD requires a
 * manager to inspect them independently rather than through a rollup gate.
 *
 * A stage with no score still gets a row. Which absence it is — not reached,
 * expired, waiting on the candidate — is named, because only some of them are
 * something to chase.
 */
export function StageScoresCard({
  scores,
  status,
  hrefFor,
}: {
  scores: CandidateScore[];
  status: ApplicationState;
  /** Anchor for each stage's evidence section, when there is one to jump to. */
  hrefFor?: (row: StageScoreRow) => string | undefined;
}) {
  const rows = stageScoreRows(scores, status);

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="border-b border-[#F3F4F6] px-[18px] py-3.5">
        <h2 className={EYEBROW}>Stage scores · never combined</h2>
      </div>

      {rows.map((row, i) => {
        const href = row.score !== null ? hrefFor?.(row) : undefined;
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[13px] font-semibold",
                  row.score === null ? "text-[#9CA3AF]" : "text-ink",
                )}
              >
                {row.label}
              </span>
              <span className="block text-[11px] text-[#9CA3AF]">{row.detail}</span>
            </span>

            {row.score === null ? (
              <span className="text-[13px] text-[#9CA3AF]" aria-hidden="true">
                —
              </span>
            ) : (
              <>
                <span className="text-[19px] font-semibold tabular-nums text-ink">
                  {row.score}
                </span>
                {row.tier && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      TIER_PILL[row.tier],
                    )}
                  >
                    {SHORT_TIER[row.tier]}
                  </span>
                )}
              </>
            )}
          </>
        );

        return (
          <div
            key={row.key}
            className={cn(
              "flex items-stretch",
              i < rows.length - 1 && "border-b border-[#F3F4F6]",
            )}
          >
            {/* Indigo only where a model has actually produced something. A
                grey rail on an unreached stage keeps the attribution honest. */}
            <span
              className={cn("w-[3px] flex-none", row.reached ? "bg-ai" : "bg-[#E5E7EB]")}
              aria-hidden="true"
            />
            {href ? (
              <Link
                href={href}
                className="flex flex-1 items-center gap-3 px-[18px] py-[13px] transition-colors duration-150 hover:bg-[#F9FAFB]"
              >
                {body}
              </Link>
            ) : (
              <div className="flex flex-1 items-center gap-3 px-[18px] py-[13px]">
                {body}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The decision, pinned beside the evidence rather than buried under it.
 *
 * The heading is a claim about the state machine, not a label: it says what has
 * happened and who it is waiting on, so a state where nothing is owed does not
 * present a row of buttons implying otherwise.
 */
export function DecisionCard({
  status,
  children,
  note,
}: {
  status: ApplicationState;
  children: ReactNode;
  /** An amber flag worth reading before acting — an unresolved conflict. */
  note?: ReactNode;
}) {
  const prompt = decisionPrompt(status);

  return (
    <section
      className={cn(
        PANEL,
        "p-[18px]",
        // A state waiting on someone else is visibly quieter than one waiting
        // on you, so a rail full of buttons cannot imply work that is not owed.
        prompt.waitingOnYou ? "bg-white" : "bg-[#F9FAFB]",
      )}
    >
      <h2 className={`${EYEBROW} mb-1`}>Your decision</h2>
      <p className="mb-1 text-[13px] font-semibold text-ink">{prompt.headline}</p>
      <p className="mb-3.5 text-xs leading-[1.55] text-[#6B7280]">{prompt.detail}</p>

      <div className="flex flex-col gap-[9px]">{children}</div>

      {note && (
        <div className="mt-3.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-[11px]">
          <p className="text-xs leading-[1.5] text-[#92400E]">{note}</p>
        </div>
      )}
    </section>
  );
}

/** The rail's own button shapes: full width, stacked, one ink primary at most. */
export const RAIL_ACTION =
  "flex w-full min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg " +
  "border border-[#D1D5DB] bg-white px-4 text-[13px] font-semibold text-[#374151] " +
  "transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export const RAIL_ACTION_PRIMARY =
  "flex w-full min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg " +
  "border border-ink bg-ink px-4 text-sm font-semibold text-white " +
  "transition-colors duration-150 hover:bg-ink-hover " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";
