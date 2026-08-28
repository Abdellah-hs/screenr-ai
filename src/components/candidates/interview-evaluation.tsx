import { INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS } from "@/lib/interview-scoring";
import type { ScoredInterviewDimension } from "@/lib/interview-scoring";
import { TranscriptJumpLink } from "./score-evidence";
import {
  CARD,
  CARD_EYEBROW,
  CARD_HEADER,
  CARD_NOTE,
  EvidenceAbsence,
  EvidenceBlock,
  EvidenceLadder,
  HEADER_ICON,
  HeaderIcon,
  LEVEL_LABELS,
  LevelChip,
  RungMeter,
} from "./evidence-level-ui";

/**
 * The AI interview's rubric breakdown, drawn on the same ladder as the CV and
 * the voice screening.
 *
 * Until 2026-08-28 this stage was the odd one out: the model was asked for a
 * 0-100 per competency and picked the competencies itself, so the recruiter's
 * interview rubric decided nothing and the number could not be reproduced. This
 * screen is the correction made visible — same rung meter, same chip, same
 * evidence block, so a manager comparing an interview score to a screening
 * score is comparing two numbers made the same way.
 *
 * Two things are deliberately unlike the screening screen, and both are rules:
 *
 * 1. **There is no threshold card.** The interview has no bar at all — it never
 *    gates and never auto-rejects, at any score, because rejecting someone who
 *    sat a whole interview on the strength of one number is the decision most
 *    worth keeping human. A pass/fail card here would name a rule that does not
 *    exist. The overall is stated by the score block above; this panel explains
 *    where it came from.
 *
 * 2. **The level wording is the interview's own.** A single example described at
 *    surface level is `strong` in a five-minute screening filter and `partial`
 *    here. Reusing the screening definitions would hand out top marks for
 *    clearing the filter's bar.
 */

/**
 * A dimension the model claimed more for than survived verification.
 *
 * `reported_evidence_level` is stored exactly so this is legible: a verified
 * `partial` and a `strong` that was knocked down to `partial` because its quote
 * could not be found are the same number and very different readings.
 */
function DowngradeNote({ dimension }: { dimension: ScoredInterviewDimension }) {
  if (dimension.reported_evidence_level === dimension.evidence_level) return null;

  return (
    <p className="mt-2.5 rounded-lg bg-[#FFFBEB] px-3 py-2 text-xs leading-[1.6] text-[#92400E]">
      <span className="font-semibold">
        Lowered from {LEVEL_LABELS[dimension.reported_evidence_level].toLowerCase()}.
      </span>{" "}
      The model read this dimension higher, but its quote could not be found in the
      candidate&rsquo;s own speech. Credit is never awarded on an unverified quote.
    </p>
  );
}

/** One rubric dimension: what it is, how well the interview evidenced it, and where. */
function DimensionRow({ dimension }: { dimension: ScoredInterviewDimension }) {
  const share = Math.round(dimension.weight * 100);

  return (
    <li className="px-5 py-4 transition-colors duration-150 hover:bg-[#FCFCFD]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="text-sm font-semibold text-ink">{dimension.name}</span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-[#9CA3AF]">
            {share}%
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          <RungMeter level={dimension.evidence_level} />
          <LevelChip
            level={dimension.evidence_level}
            definition={INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS[dimension.evidence_level]}
          />
          <span className="w-7 text-right text-sm font-semibold tabular-nums text-ink">
            {dimension.score}
          </span>
        </span>
      </div>

      <DowngradeNote dimension={dimension} />

      {dimension.evidence_items.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {dimension.evidence_items.map((item, i) => (
            <li key={`${dimension.dimension_id}-quote-${i}`}>
              <EvidenceBlock
                // Named as the candidate's, always. The interviewer states the
                // topic of every question, so a quote lifted from their turn
                // would award credit for the topic merely having been raised —
                // verification only ever searches the candidate's half, and the
                // label says which half the reader is looking at.
                eyebrow={
                  typeof item.turn_index === "number"
                    ? `Candidate · turn ${item.turn_index + 1}`
                    : "Candidate"
                }
                quote={item.quote}
                explanation={item.explanation}
              >
                <TranscriptJumpLink anchorPrefix="interview" turnIndex={item.turn_index} />
              </EvidenceBlock>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2.5">
          <EvidenceAbsence>
            Nothing in the candidate&rsquo;s speech was verified against this dimension —
            either the interview never reached it, or what was said did not establish it.
          </EvidenceAbsence>
        </div>
      )}

      {dimension.notes && (
        <p className="mt-2 text-[11px] leading-[1.55] text-[#9CA3AF]">{dimension.notes}</p>
      )}
    </li>
  );
}

/**
 * The rubric breakdown for a scored AI interview.
 *
 * Renders nothing when the interview was scored by the retired numeric prompt —
 * `dimension_scores` is null for everything before 2026-08-28. Those keep
 * rendering from `dimensions[].score`, because a score should show the unit it
 * was actually graded in rather than be redrawn in the unit the product uses
 * today. Re-score to move an old interview onto the current rules.
 */
export default function InterviewEvaluation({
  dimensions,
  usedDefaultRubric = false,
}: {
  dimensions: ScoredInterviewDimension[];
  /**
   * True when the campaign had no interview rubric and the default competency
   * set stood in. Worth saying plainly: the recruiter is looking at a breakdown
   * they did not author, and the remedy is to build the rubric.
   */
  usedDefaultRubric?: boolean;
}) {
  if (dimensions.length === 0) return null;

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className={CARD_HEADER}>
          <h4 className={CARD_EYEBROW}>
            <HeaderIcon d={HEADER_ICON.rubric} />
            Rubric breakdown
          </h4>
          <span className="text-[11px] tabular-nums text-[#9CA3AF]">
            {dimensions.length} dimension{dimensions.length === 1 ? "" : "s"} · no gate
          </span>
        </div>

        <p className={CARD_NOTE}>
          Evidence is read across the{" "}
          <span className="font-semibold text-[#4B5563]">whole transcript</span>, per
          dimension — a competency proved while answering some other question has still
          been proved. The percentage is each dimension&rsquo;s share of the overall,
          derived from the importance you set in the rubric; the model is never shown it.
          The interview never rejects anyone, whatever this total comes to.
        </p>

        {usedDefaultRubric && (
          <p className="mx-5 mb-3 rounded-lg bg-[#FFFBEB] px-3 py-2 text-xs leading-[1.6] text-[#92400E]">
            <span className="font-semibold">Scored against a default competency set.</span>{" "}
            This campaign has no interview rubric, so these four stood in. Build an
            interview rubric to grade candidates on what this role actually needs.
          </p>
        )}

        <ul className="divide-y divide-[#F3F4F6]">
          {dimensions.map((dimension) => (
            <DimensionRow key={dimension.dimension_id} dimension={dimension} />
          ))}
        </ul>
      </section>

      <EvidenceLadder
        definitions={INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS}
        footnote="The AI picks a level and nothing else — it never returns a number, and it is never shown the weights. These definitions are the exact wording it is given. They ask for more than the screening stage's at every rung: this is the deep stage, so one example described at surface level is 'partial' here where a short screening call would read it as 'strong'."
      />
    </div>
  );
}
