import Link from "next/link";
import type { EvaluationRubric, DimensionImportance } from "@/lib/constants";

interface RubricDisplayProps {
  rubrics: EvaluationRubric[];
  campaignId: string;
  /** Candidates carrying a score from an older rubric version, if known. */
  staleScoreCount?: number;
}

const STAGE_LABELS: Record<string, string> = {
  resume: "Resume",
  screening_q: "Screening questions",
  interview: "Interview",
};

const IMPORTANCE_LABELS: Record<DimensionImportance, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const ROW = "grid [grid-template-columns:minmax(0,1fr)_132px_132px]";

/**
 * The rubric as a table of criteria, requirement and importance — and nothing
 * else.
 *
 * There is deliberately no weight column. Weighting is derived from
 * must-have/nice-to-have and importance, because a number you can nudge is a
 * number you will nudge until the rubric agrees with the answer you already
 * wanted. The paragraph says so, in the place someone would go looking for the
 * missing control.
 */
export default function RubricDisplay({
  rubrics,
  campaignId,
  staleScoreCount = 0,
}: RubricDisplayProps) {
  const activeRubrics = rubrics.filter((r) => r.is_active && r.dimensions.length > 0);

  if (activeRubrics.length === 0) return null;

  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-1.5 flex items-center justify-between gap-3.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
          Scoring rubric
          {activeRubrics.length === 1 && (
            <span className="font-medium normal-case tracking-normal text-[#9CA3AF]">
              {" "}
              · v{activeRubrics[0].version}
            </span>
          )}
        </h2>
        <Link
          href={`/campaigns/${campaignId}/edit#rubric`}
          className="inline-flex min-h-9 items-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB]"
        >
          Edit rubric
        </Link>
      </div>

      <p className="mb-[18px] max-w-[70ch] text-[13px] leading-[1.55] text-[#6B7280]">
        You mark each criterion must-have or nice-to-have and how much it matters. The
        AI derives the weighting from that — there are no numbers for you to tune,
        because a number you can nudge is a number you will nudge to get the answer you
        wanted.
      </p>

      <div className="space-y-5">
        {activeRubrics.map((rubric) => (
          <div key={rubric.id}>
            {activeRubrics.length > 1 && (
              <h3 className="mb-2 text-[13px] font-semibold text-ink">
                {STAGE_LABELS[rubric.stage] ?? rubric.stage}
                <span className="font-medium text-[#9CA3AF]"> · v{rubric.version}</span>
              </h3>
            )}

            <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
              <div className={`${ROW} border-b border-[#E5E7EB] bg-[#F9FAFB]`}>
                <span className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                  Criterion
                </span>
                <span className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                  Requirement
                </span>
                <span className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                  Importance
                </span>
              </div>

              {rubric.dimensions.map((dim, i) => (
                <div
                  key={dim.id}
                  className={`${ROW} ${
                    i < rubric.dimensions.length - 1 ? "border-b border-[#F3F4F6]" : ""
                  }`}
                >
                  <span className="px-3.5 py-3 text-[13px] text-ink">{dim.name}</span>
                  <span className="px-3.5 py-3">
                    {/* Indigo for must-have, grey for nice-to-have: this is the
                        line the AI is not allowed to cross, not a severity. */}
                    <span
                      className={`rounded-md px-2.5 py-[3px] text-[11px] font-semibold ${
                        dim.is_mandatory
                          ? "bg-[#EEF2FF] text-[#4338CA]"
                          : "bg-[#F3F4F6] text-[#4B5563]"
                      }`}
                    >
                      {dim.is_mandatory ? "Must-have" : "Nice-to-have"}
                    </span>
                  </span>
                  <span className="px-3.5 py-3 text-[13px] font-semibold text-[#374151]">
                    {IMPORTANCE_LABELS[dim.importance]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {staleScoreCount > 0 && activeRubrics.length === 1 && (
        <div className="mt-3.5 rounded-r-lg border-l-[3px] border-ai bg-ai-wash px-3.5 py-3">
          <p className="text-xs leading-[1.55] text-[#4B5563]">
            <strong className="font-semibold text-ai-deep">
              Rubric v{activeRubrics[0].version} is live.
            </strong>{" "}
            {staleScoreCount}{" "}
            {staleScoreCount === 1 ? "candidate was" : "candidates were"} scored against
            an earlier version and {staleScoreCount === 1 ? "is" : "are"} marked as such
            on their files — an old score is never silently compared to a new one.
          </p>
        </div>
      )}
    </section>
  );
}
