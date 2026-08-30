import { SCREENING_EVIDENCE_LEVEL_DEFINITIONS } from "@/lib/screening-scoring";
import type { ScoredScreeningDimension } from "@/lib/screening-scoring";
import { TranscriptJumpLink } from "./score-evidence";
import {
  CARD,
  CARD_EYEBROW,
  CARD_HEADER,
  CARD_NOTE,
  DowngradeNote,
  EvidenceAbsence,
  EvidenceBlock,
  EvidenceLadder,
  HEADER_ICON,
  HeaderIcon,
  LevelChip,
  RungMeter,
  ScoreCaveatNotice,
  ThresholdCard,
} from "./evidence-level-ui";

/**
 * The voice screening's rubric breakdown, drawn on the same ladder as the CV.
 *
 * A recruiter comparing a CV score to a screening score is comparing two numbers
 * made the same way — `src/lib/scoring/evidence-levels.ts` is shared precisely so
 * `strong` is worth 80 wherever it was read. This screen is that commitment made
 * visible: same rung meter, same chip, same evidence block. Only the *wording* of
 * each level differs, because a CV proves a skill by listing a role and a
 * duration and an answer proves it by what the candidate can say about the work.
 *
 * Three things are deliberately unlike the resume screen, and each is a rule:
 *
 * 1. **No gate glyphs and no tick on any meter.** There is no must-have on
 *    screening — a weak answer lowers the score and never auto-rejects, because
 *    speech transcribed is noisier evidence than a document. A pass/fail column
 *    here would name a rule that does not exist.
 *
 * 2. **The weight is shown.** On the resume stage weights do not exist; here the
 *    overall really is a weighted mean, and the weight is the difference between
 *    a dimension's number and the total. A recruiter looking at a 40 beside an 80
 *    deserves to see which one the rubric said counts for more.
 *
 * 3. **Missing the threshold is amber, not red, and says so.** Since 2026-08-22
 *    the screening threshold advances and never rejects: below it the candidate
 *    rests at `screening_scored` for a person to decide. Dressing that as a
 *    failure would misstate what happens next.
 */


/**
 * The call lost an answer the candidate actually gave.
 *
 * **The one thing the score below cannot say about itself.** Every number here
 * is derived from evidence found in the transcript, so an answer that never
 * reached the transcript is scored exactly like an answer that was never given
 * — `not_present`, 0 — and nothing in the breakdown distinguishes them. The
 * recruiter reads "established nothing" about a candidate who established
 * something we failed to write down.
 *
 * It happens because the interviewer and the record come from two different
 * places: OpenAI Realtime understands the audio natively, so the conversation
 * carries on perfectly, while the TEXT comes from a separate transcription
 * sidecar that can return nothing. On the calls that surfaced this, the only
 * surviving trace of the candidate speaking is the interviewer thanking them
 * for an answer that appears nowhere.
 *
 * So this is amber and it sits ABOVE the breakdown, before any number is read.
 * It is deliberately not phrased as a fault of the candidate's and does not
 * suggest a verdict: the remedy is a person listening to what is there, or a
 * fresh link — never a rejection on a score we have just said may be wrong.
 */
function UnheardAnswersNotice({ count }: { count: number }) {
  if (count < 1) return null;

  return (
    <ScoreCaveatNotice
      heading="This score may be understated"
      remedy={
        <>
          This is a failure on our side, not the candidate&rsquo;s. Read the transcript
          below before acting on the number &mdash; or send a fresh screening link.
        </>
      }
    >
      {count === 1 ? "One answer" : `${count} answers`} the candidate gave{" "}
      {count === 1 ? "was" : "were"} heard on the call but never transcribed, so{" "}
      {count === 1 ? "it is" : "they are"} missing from the record the score is read
      from. A dimension those words would have evidenced scores 0 here exactly as it
      would if nothing had been said.
    </ScoreCaveatNotice>
  );
}

/** One rubric dimension: what it is, how well the call evidenced it, and where. */
function DimensionRow({ dimension }: { dimension: ScoredScreeningDimension }) {
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
            definition={SCREENING_EVIDENCE_LEVEL_DEFINITIONS[dimension.evidence_level]}
          />
          <span className="w-7 text-right text-sm font-semibold tabular-nums text-ink">
            {dimension.score}
          </span>
        </span>
      </div>

      <DowngradeNote
        level={dimension.evidence_level}
        reportedLevel={dimension.reported_evidence_level}
      />

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
                <TranscriptJumpLink anchorPrefix="screening" turnIndex={item.turn_index} />
              </EvidenceBlock>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2.5">
          {/* The scorer cannot tell "asked and gave nothing" from "never asked",
              and must not try — both are the same input from inside it. So this
              says only what is certain, and leaves the diagnosis to the coverage
              check that runs upstream, on the questions. */}
          <EvidenceAbsence>
            Nothing in the candidate&rsquo;s speech was verified against this dimension —
            either it never came up, or what was said did not establish it.
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
 * The rubric breakdown for a scored voice screening.
 *
 * Renders nothing when the response was scored per question — `dimension_scores`
 * is null for everything before 2026-08-22 and for the legacy typed-answer path.
 * Those keep rendering from `answers[].score`, because a score should show the
 * unit it was actually graded in rather than be redrawn in the unit the product
 * uses today.
 */
export default function ScreeningEvaluation({
  dimensions,
  overallScore,
  screeningThreshold,
  unheardAnswers = 0,
}: {
  dimensions: ScoredScreeningDimension[];
  /** Null only in the odd state of a scored response carrying no total. */
  overallScore: number | null;
  /** The campaign's bar for this stage — never the resume one. */
  screeningThreshold: number;
  /**
   * How many answers the call heard and failed to transcribe. Defaults to 0,
   * which is also what every call taken before this was counted reads as — the
   * honest default, since nothing observed it then.
   */
  unheardAnswers?: number;
}) {
  if (dimensions.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Before any number, because it changes how every number below should
          be read. */}
      <UnheardAnswersNotice count={unheardAnswers} />

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
        </p>

        <ul className="divide-y divide-[#F3F4F6]">
          {dimensions.map((dimension) => (
            <DimensionRow key={dimension.dimension_id} dimension={dimension} />
          ))}
        </ul>
      </section>

      {overallScore != null && (
        <ThresholdCard
          label="Overall"
          score={overallScore}
          threshold={screeningThreshold}
          miss="holds"
        >
          {/* Amber rather than red below the line, and this says why: on this
              stage missing the bar is a queue, not a rejection. */}
          <p className="max-w-[68ch] text-xs leading-[1.6] text-[#6B7280]">
            The weighted mean of all {dimensions.length} dimension
            {dimensions.length === 1 ? "" : "s"}, covered by the call or not.{" "}
            {overallScore >= screeningThreshold
              ? "Clearing this bar invites the candidate to the AI interview."
              : "Missing it is not a rejection — the candidate rests here for a person to decide. Screening never auto-rejects."}
          </p>
        </ThresholdCard>
      )}

      <EvidenceLadder
        definitions={SCREENING_EVIDENCE_LEVEL_DEFINITIONS}
        footnote="The AI picks a level and nothing else — it never returns a number, and it is never shown the weights. These definitions are the exact wording it is given, worded for spoken evidence rather than a document, and where evidence is borderline it is instructed to pick the lower level."
      />
    </div>
  );
}
