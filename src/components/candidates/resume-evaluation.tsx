import type {
  DeterministicResumeScoreResult,
  EvidenceLevel,
  ScoredCriterion,
} from "@/lib/resume-scoring";

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
 */

const LEVEL_LABELS: Record<EvidenceLevel, string> = {
  not_present: "Not present",
  unclear: "Unclear",
  weak: "Weak",
  partial: "Partial",
  strong: "Strong",
  very_strong: "Very strong",
};

/**
 * Colour is never the only signal here: every row also carries the level word,
 * the numeric score, and a Pass/Fail chip for must-haves.
 */
const LEVEL_STYLES: Record<EvidenceLevel, string> = {
  not_present: "bg-[#FEE2E2] text-[#991B1B]",
  unclear: "bg-[#F3F4F6] text-[#4B5563]",
  weak: "bg-[#FEF3C7] text-[#92400E]",
  partial: "bg-[#FEF3C7] text-[#92400E]",
  strong: "bg-[#DCFCE7] text-[#166534]",
  very_strong: "bg-[#DCFCE7] text-[#166534]",
};

function CriterionRow({
  criterion,
  minimumScore,
}: {
  criterion: ScoredCriterion;
  minimumScore: number | null;
}) {
  const failed = minimumScore != null && criterion.score < minimumScore;

  return (
    <li className="rounded-lg border border-[#E2E8F0] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#0C4A6E]">{criterion.label}</span>
          {minimumScore != null && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                failed ? "bg-[#FEE2E2] text-[#991B1B]" : "bg-[#DCFCE7] text-[#166534]"
              }`}
            >
              {failed ? "Fail" : "Pass"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
              LEVEL_STYLES[criterion.evidence_level]
            }`}
          >
            {LEVEL_LABELS[criterion.evidence_level]}
          </span>
          <span className="text-xs font-semibold text-[#0C4A6E]">
            {criterion.score}
            {minimumScore != null && (
              <span className="font-normal text-[#9CA3AF]"> / min {minimumScore}</span>
            )}
          </span>
        </div>
      </div>

      {criterion.evidence_items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {criterion.evidence_items.map((item, i) => (
            <li
              key={`${criterion.id}-quote-${i}`}
              className="rounded-md border-l-2 border-[#BAE6FD] bg-[#F9FAFB] py-1 pl-2.5 pr-2"
            >
              <blockquote className="text-[11px] leading-relaxed text-[#4B5563]">
                “{item.quote}”
              </blockquote>
              <p className="mt-0.5 text-[10px] text-[#9CA3AF]">
                {item.source_section} · {item.explanation}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[11px] italic text-[#9CA3AF]">
          No verifiable quote was found in the resume for this criterion.
        </p>
      )}

      {criterion.extracted_relevant_months != null && (
        <p className="mt-1.5 text-[10px] text-[#6B7280]">
          Stated duration: {criterion.extracted_relevant_months} months (recorded as context —
          it does not affect the score).
        </p>
      )}
    </li>
  );
}

export default function ResumeEvaluation({
  evaluation,
}: {
  evaluation: DeterministicResumeScoreResult;
}) {
  const mustHaves = evaluation.criteria.filter((c) => c.priority === "must_have");
  const niceToHaves = evaluation.criteria.filter((c) => c.priority === "nice_to_have");
  const minimumScore = evaluation.failed_must_haves[0]?.minimum_score ?? 60;

  return (
    <div className="space-y-4">
      {!evaluation.eligible && evaluation.failed_must_haves.length > 0 && (
        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3">
          <p className="text-xs font-semibold text-[#991B1B]">
            Ineligible — {evaluation.failed_must_haves.length} must-have{" "}
            {evaluation.failed_must_haves.length === 1 ? "criterion" : "criteria"} not met
          </p>
          <ul className="mt-1.5 space-y-1">
            {evaluation.failed_must_haves.map((failure) => (
              <li key={failure.criterion_label} className="text-[11px] text-[#7F1D1D]">
                {failure.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-[#7F1D1D]">
            Nice-to-have criteria are not scored for an ineligible candidate — they cannot
            offset a must-have.
          </p>
        </div>
      )}

      {mustHaves.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Must-have criteria · all must pass
          </h4>
          <ul className="space-y-2">
            {mustHaves.map((criterion) => (
              <CriterionRow
                key={criterion.id}
                criterion={criterion}
                minimumScore={minimumScore}
              />
            ))}
          </ul>
        </section>
      )}

      {niceToHaves.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Nice-to-have criteria · ranking only
          </h4>
          <ul className="space-y-2">
            {niceToHaves.map((criterion) => (
              <CriterionRow key={criterion.id} criterion={criterion} minimumScore={null} />
            ))}
          </ul>
        </section>
      )}

      {evaluation.validation_warnings.length > 0 && (
        <details className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
          <summary className="cursor-pointer text-[11px] font-medium text-[#92400E]">
            {evaluation.validation_warnings.length} evidence warning
            {evaluation.validation_warnings.length === 1 ? "" : "s"} — quotes the system could
            not confirm
          </summary>
          <ul className="mt-1.5 space-y-1">
            {evaluation.validation_warnings.map((warning, i) => (
              <li key={`warning-${i}`} className="text-[10px] leading-relaxed text-[#78350F]">
                {warning}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
