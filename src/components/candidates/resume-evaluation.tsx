import { firstLevelClearing } from "@/lib/candidates/resume-score-copy";
import { EVIDENCE_LEVEL_DEFINITIONS, MUST_HAVE_MINIMUM_SCORE } from "@/lib/resume-scoring";
import type {
  DeterministicResumeScoreResult,
  EvidenceSourceSection,
  MustHaveFailure,
  ScoredCriterion,
} from "@/lib/resume-scoring";
import { cn } from "@/lib/utils";
import {
  CARD,
  CARD_EYEBROW,
  CARD_HEADER,
  EvidenceAbsence,
  EvidenceBlock,
  EvidenceLadder,
  FAIL_PILL,
  HEADER_ICON,
  HeaderIcon,
  LEVEL_LABELS,
  LevelChip,
  PASS_PILL,
  PILL,
  RungMeter,
  ThresholdCard,
} from "./evidence-level-ui";

/**
 * The resume evaluation, shown the way it was decided: gates first, ranking
 * second, and never the two mixed into one number.
 *
 * The old card put a single weighted score at the top with a bar chart of
 * weighted factors underneath, which quietly told the reader that a shortfall
 * here could be paid for by a surplus there. It cannot. So must-haves render as
 * a pass/fail list, the ranking score renders only when it exists, and each
 * criterion carries the quote it was judged on — the point of evidence-based
 * screening is that a recruiter can check the reasoning rather than trust it.
 *
 * Four things about the *layout* are decisions rather than taste:
 *
 * 1. **Two objects, not one list.** A gate and a ranking are different kinds of
 *    result, so they are different cards: the requirements card is a checklist
 *    with a met/not-met count, the ranking card is a single number against the
 *    campaign's bar. The nice-to-haves sit between them because they exist only
 *    to feed the second, and their card deliberately has no status column — the
 *    absence of the pass/fail glyph is what says "nothing here is a gate".
 *
 * 2. **The ranking comes last.** It is the mean of every criterion, so it reads
 *    as a conclusion once the criteria have been seen. It used to sit between
 *    the two lists, claiming an average over rows the reader had not reached.
 *
 * 3. **Rows, not nested cards.** Each criterion was its own bordered box inside
 *    a bordered section, which framed every line equally and left the quotes —
 *    a third box deep — reading as an aside. They are the substance, so they get
 *    the indigo edge and the readable type, and the frames around them are gone.
 *
 * 4. **A level's definition is shown once, not five times.** It is a property of
 *    the level, not of the criterion, and printing it under every row buried the
 *    quotes in a paragraph repeated verbatim three times. It now hangs off the
 *    level chip on hover and focus, stays in the accessibility tree, and is
 *    listed in full in the ladder at the bottom. The one place it is still
 *    spelled out inline is a failed must-have, where "what would have been
 *    enough" is the question the recruiter is actually holding.
 *
 * The rung meter, the level chip and the ladder live in `evidence-level-ui` and
 * are shared with the voice screening, because the two stages grade on one
 * ladder and must be seen to. Only the *wording* of each level is stage-specific.
 */

/** Where in the CV a quote was lifted from, in words rather than a field name. */
const SECTION_LABELS: Record<EvidenceSourceSection, string> = {
  headline: "Headline",
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  certifications: "Certifications",
  languages: "Languages",
  other: "Elsewhere in the CV",
};

/** Met or not met, as a shape rather than only a colour. */
function GateGlyph({ passed }: { passed: boolean }) {
  return (
    <span
      className={cn(
        "mt-[1px] flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full",
        passed ? "bg-[#ECFDF5] text-[#047857]" : "bg-[#FEF2F2] text-[#B91C1C]",
      )}
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={passed ? "m4.5 12.75 6 6 9-13.5" : "M6 18 18 6M6 6l12 12"}
        />
      </svg>
      <span className="sr-only">{passed ? "Met" : "Not met"}</span>
    </span>
  );
}

/**
 * One criterion: what it is, how strongly the CV evidenced it, and the quotes
 * that reading rests on.
 */
function CriterionRow({
  criterion,
  minimumScore,
  failure,
}: {
  criterion: ScoredCriterion;
  /** Null for a nice-to-have: there is no gate, so there is nothing to pass. */
  minimumScore: number | null;
  /**
   * The gate's own verdict on this criterion, or null if it cleared.
   *
   * Read rather than recomputed. `evaluateEligibility` already decided this,
   * and `MustHaveFailure` carries the minimum it actually applied — so a
   * criterion that one day gets its own floor cannot end up with a green tick
   * here beside a rejection from the rule.
   */
  failure: MustHaveFailure | null;
}) {
  const gated = minimumScore != null;
  const failed = failure != null;
  const appliedMinimum = failure?.minimum_score ?? minimumScore;
  const requiredLevel = appliedMinimum != null ? firstLevelClearing(appliedMinimum) : null;

  return (
    <li className="px-5 py-4 transition-colors duration-150 hover:bg-[#FCFCFD]">
      <div className="flex items-start gap-3">
        {gated && <GateGlyph passed={!failed} />}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <span className="text-sm font-semibold text-ink">{criterion.label}</span>
            <span className="flex shrink-0 items-center gap-2.5">
              <RungMeter level={criterion.evidence_level} gateLevel={requiredLevel} />
              <LevelChip
                level={criterion.evidence_level}
                definition={EVIDENCE_LEVEL_DEFINITIONS[criterion.evidence_level]}
              />
              <span className="w-7 text-right text-sm font-semibold tabular-nums text-ink">
                {criterion.score}
              </span>
            </span>
          </div>

          {/* "Why not?" is answered by the level and its definition. This answers
              "what would have been enough?", which is the question a recruiter
              acts on — it separates a harsh reading from a CV that genuinely
              lacks the evidence. Only shown where a gate was actually missed:
              on a row that cleared, "needs 60" restates what the tick and the
              green check already say. */}
          {failed && requiredLevel && (
            <p className="mt-2.5 rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs leading-[1.6] text-[#991B1B]">
              <span className="font-semibold">
                Needed {LEVEL_LABELS[requiredLevel].toLowerCase()} evidence ({appliedMinimum}):
              </span>{" "}
              {EVIDENCE_LEVEL_DEFINITIONS[requiredLevel]}
            </p>
          )}

          {criterion.evidence_items.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5">
              {criterion.evidence_items.map((item, i) => (
                <li key={`${criterion.id}-quote-${i}`}>
                  <EvidenceBlock
                    eyebrow={SECTION_LABELS[item.source_section]}
                    quote={item.quote}
                    explanation={item.explanation}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2.5">
              <EvidenceAbsence>
                No verifiable quote was found in the resume for this criterion.
              </EvidenceAbsence>
            </div>
          )}

          {/* This line used to say the duration does not affect the score. It does
              now — the evidence levels are defined partly by duration floors, so
              the figure moves the level, which moves the number. It is still not
              added to anything directly, and the distinction is worth keeping
              straight for anyone auditing a score. */}
          {criterion.extracted_relevant_months != null && (
            <p className="mt-2 text-[11px] text-[#9CA3AF]">
              Stated duration {criterion.extracted_relevant_months} months — read from
              the CV, and one of the things the level above is judged on.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ResumeEvaluation({
  evaluation,
  resumeThreshold,
}: {
  evaluation: DeterministicResumeScoreResult;
  /** The campaign's own pass mark, applied to the ranking score below. */
  resumeThreshold: number;
}) {
  const mustHaves = evaluation.criteria.filter((c) => c.priority === "must_have");
  const niceToHaves = evaluation.criteria.filter((c) => c.priority === "nice_to_have");
  // Which must-haves failed is the RULE's verdict, not something to re-derive
  // from a score and a guessed floor: `evaluateEligibility` ran criterion by
  // criterion and `failed_must_haves` is what it concluded.
  const failures = new Map(evaluation.failed_must_haves.map((f) => [f.criterion_label, f]));
  const metCount = mustHaves.length - evaluation.failed_must_haves.length;
  const allMet = evaluation.failed_must_haves.length === 0;
  // Only the gate marker on a row that CLEARED still needs a number, and the
  // scorer records none for those. The constant is the floor it applied.
  const minimumScore = MUST_HAVE_MINIMUM_SCORE;

  return (
    <div className="space-y-4">
      {!evaluation.eligible && evaluation.failed_must_haves.length > 0 && (
        <section className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-5 py-4">
          <div className="flex items-start gap-3">
            <svg
              className="mt-[1px] h-[18px] w-[18px] flex-none text-[#B91C1C]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#991B1B]">
                Ineligible — {evaluation.failed_must_haves.length} requirement
                {evaluation.failed_must_haves.length === 1 ? "" : "s"} not met
              </p>
              <ul className="mt-2 space-y-1">
                {evaluation.failed_must_haves.map((failure) => (
                  <li
                    key={failure.criterion_label}
                    className="text-xs leading-[1.6] text-[#7F1D1D]"
                  >
                    {failure.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 border-t border-[#FECACA] pt-2.5 text-xs leading-[1.6] text-[#B91C1C]">
                An ineligible candidate is not ranked at all — no criterion, of either
                kind, can offset a failed requirement.
              </p>
            </div>
          </div>
        </section>
      )}

      {mustHaves.length > 0 && (
        <section className={CARD}>
          <div className={CARD_HEADER}>
            <h4 className={CARD_EYEBROW}>
              <HeaderIcon d={HEADER_ICON.requirements} />
              Requirements · the gate
            </h4>
            <span
              className={cn(PILL, "tabular-nums", allMet ? PASS_PILL : FAIL_PILL)}
            >
              {metCount} of {mustHaves.length} met
            </span>
          </div>

          <ul className="divide-y divide-[#F3F4F6]">
            {mustHaves.map((criterion) => (
              <CriterionRow
                key={criterion.id}
                criterion={criterion}
                minimumScore={minimumScore}
                failure={failures.get(criterion.label) ?? null}
              />
            ))}
          </ul>
        </section>
      )}

      {niceToHaves.length > 0 && (
        <section className={CARD}>
          <div className={CARD_HEADER}>
            <h4 className={CARD_EYEBROW}>
              <HeaderIcon d={HEADER_ICON.also} />
              Also assessed
            </h4>
          </div>
          <ul className="divide-y divide-[#F3F4F6]">
            {niceToHaves.map((criterion) => (
              <CriterionRow key={criterion.id} criterion={criterion} minimumScore={null} failure={null} />
            ))}
          </ul>
        </section>
      )}

      {evaluation.ranking_score != null && (
        <ThresholdCard label="Ranking" score={evaluation.ranking_score} threshold={resumeThreshold} miss="rejects" />
      )}

      <EvidenceLadder definitions={EVIDENCE_LEVEL_DEFINITIONS} />

      {evaluation.validation_warnings.length > 0 && (
        <details className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB]">
          <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-[#92400E]">
            {evaluation.validation_warnings.length} evidence warning
            {evaluation.validation_warnings.length === 1 ? "" : "s"} — quotes the system
            could not confirm
          </summary>
          <ul className="space-y-1.5 border-t border-[#FDE68A] px-5 py-3">
            {evaluation.validation_warnings.map((warning, i) => (
              <li key={`warning-${i}`} className="text-xs leading-[1.6] text-[#78350F]">
                {warning}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
