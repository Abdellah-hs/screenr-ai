import type { EvaluationRubric, DimensionImportance } from "@/lib/constants";
import EditRubricButton from "./edit-rubric-button";

interface RubricDisplayProps {
  rubrics: EvaluationRubric[];
  campaignId: string;
  /** Candidates carrying a score from an older rubric version, if known. */
  staleScoreCount?: number;
  /** The role description the in-place editor drafts dimensions from. */
  description?: string;
}

const STAGE_LABELS: Record<string, string> = {
  resume: "Resume",
  screening_q: "Screening questions",
  interview: "Interview",
};

/**
 * What each stage actually does with the rows below it.
 *
 * Three tables of criteria look interchangeable, and they are not: one gates,
 * two rank. Saying so beside the table is the difference between a recruiter
 * reading a rubric and a recruiter guessing at one.
 */
const STAGE_CAPTIONS: Record<string, string> = {
  resume:
    "Read from the CV. Every must-have has to pass on its own — one miss is a rejection. The nice-to-haves are averaged into the ranking score.",
  screening_q:
    "Read from the voice transcript, weighted by importance. There is no must-have gate here: a weak answer lowers the score, it never rejects.",
  interview:
    "Read from the interview transcript, weighted by importance. The interview score never gates and never auto-rejects.",
};

const IMPORTANCE_LABELS: Record<DimensionImportance, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Filled segments out of three — importance is ordinal, so it can be seen. */
const IMPORTANCE_BARS: Record<DimensionImportance, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Criterion, then the one thing that stage decides about it. */
const ROW = "grid items-center [grid-template-columns:minmax(0,1fr)_148px]";

/**
 * Only the resume rubric has must-haves.
 *
 * Screening and the interview have no must-have gate at all — a weak answer
 * lowers the score and never auto-rejects — so a "Must-have" badge on either
 * would name a rule nothing enforces. The editor stopped collecting the flag
 * for those stages; this stops the read-only view asserting it for rubrics
 * saved before it did.
 */
function showsRequirement(stage: string): boolean {
  return stage === "resume";
}

/**
 * ...and only the graded stages have importance — the mirror of the rule
 * above, missing until now.
 *
 * `importance` is not a recruiter input on the resume stage: the editor hides
 * the control and derives the value from the must-have choice (must → high,
 * nice → medium), because must-haves are gates and nice-to-haves are averaged
 * unweighted. Printing "High" beside a resume criterion therefore reported a
 * dial nobody turned and nothing reads, right beside the badge that is the
 * real decision. One column per stage, and it is the column that stage acts on.
 */
function showsImportance(stage: string): boolean {
  return stage !== "resume";
}

/**
 * The rubric as one table per stage — criterion, and the single property that
 * stage scores on.
 *
 * There is deliberately no weight column. Weighting is derived from
 * must-have/nice-to-have and importance, because a number you can nudge is a
 * number you will nudge until the rubric agrees with the answer you already
 * wanted.
 */
export default function RubricDisplay({
  rubrics,
  campaignId,
  staleScoreCount = 0,
  description,
}: RubricDisplayProps) {
  const activeRubrics = rubrics.filter((r) => r.is_active && r.dimensions.length > 0);

  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-3.5 border-b border-[#F3F4F6] px-[22px] py-4">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
            Scoring rubric
          </h2>
          <p className="mt-1 text-[13px] leading-[1.55] text-[#6B7280]">
            What every candidate is measured against, stage by stage.
          </p>
        </div>
        {/* Opens here, over the rubric it edits. It used to be a link into the
            five-step campaign wizard — the whole campaign, walked from the top,
            to change one criterion. */}
        <EditRubricButton
          campaignId={campaignId}
          rubrics={activeRubrics}
          description={description}
        />
      </div>

      {/* No inner scroller. A panel whose job is "read what this campaign will
          do" cannot slice a criterion in half against a fixed height — the page
          scrolls instead, and the whole rubric is on it. */}
      <div className="flex flex-col gap-7 px-[22px] py-[22px]">
        {/* Said, not hidden. This card used to render nothing at all without a
            rubric, so the one campaign that most needs an "Edit rubric" button
            was the one campaign that had none. */}
        {activeRubrics.length === 0 && (
          <p className="rounded-lg border border-dashed border-[#E5E7EB] px-3.5 py-5 text-center text-[13px] leading-[1.55] text-[#6B7280]">
            No rubric yet. Nothing is scored against anything until this campaign
            has one — draft it from the role description, or write your own.
          </p>
        )}

        {activeRubrics.map((rubric) => {
          const withRequirement = showsRequirement(rubric.stage);
          const withImportance = showsImportance(rubric.stage);
          const mustHaves = rubric.dimensions.filter((d) => d.is_mandatory).length;

          return (
            <div key={rubric.id}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-[13px] font-semibold text-ink">
                  {STAGE_LABELS[rubric.stage] ?? rubric.stage}
                  <span className="font-medium text-[#9CA3AF]"> · v{rubric.version}</span>
                </h3>
                <span className="text-xs tabular-nums text-[#9CA3AF]">
                  {withRequirement
                    ? `${mustHaves} must-have · ${rubric.dimensions.length - mustHaves} nice-to-have`
                    : `${rubric.dimensions.length} ${
                        rubric.dimensions.length === 1 ? "dimension" : "dimensions"
                      }`}
                </span>
              </div>

              <p className="mb-3 max-w-[64ch] text-xs leading-[1.6] text-[#6B7280]">
                {STAGE_CAPTIONS[rubric.stage]}
              </p>

              <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
                <div className={`${ROW} border-b border-[#E5E7EB] bg-[#F9FAFB]`}>
                  <span className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                    Criterion
                  </span>
                  <span className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                    {withRequirement ? "Requirement" : "Importance"}
                  </span>
                </div>

                {rubric.dimensions.map((dim, i) => (
                  <div
                    key={dim.id}
                    className={`${ROW} ${
                      i < rubric.dimensions.length - 1 ? "border-b border-[#F3F4F6]" : ""
                    }`}
                  >
                    <span className="px-3.5 py-3 text-[13px] leading-[1.5] text-ink">
                      {dim.name}
                    </span>

                    {withRequirement && (
                      <span className="px-3.5 py-3">
                        {/* Indigo badge for the gate, plain grey text for the
                            rest. Badging both made every row shout, and the one
                            row that can reject someone no easier to find than
                            the five that cannot. */}
                        {dim.is_mandatory ? (
                          <span className="rounded-md bg-[#EEF2FF] px-2.5 py-[3px] text-[11px] font-semibold text-[#4338CA]">
                            Must-have
                          </span>
                        ) : (
                          <span className="text-[13px] text-[#9CA3AF]">Nice-to-have</span>
                        )}
                      </span>
                    )}

                    {withImportance && (
                      <span className="flex items-center gap-2.5 px-3.5 py-3">
                        <span className="flex gap-[3px]" aria-hidden="true">
                          {[0, 1, 2].map((seg) => (
                            <span
                              key={seg}
                              className={`h-3 w-[3px] rounded-full ${
                                seg < IMPORTANCE_BARS[dim.importance]
                                  ? "bg-[#6B7280]"
                                  : "bg-[#E5E7EB]"
                              }`}
                            />
                          ))}
                        </span>
                        <span className="text-[13px] font-medium text-[#374151]">
                          {IMPORTANCE_LABELS[dim.importance]}
                        </span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {staleScoreCount > 0 && activeRubrics.length === 1 && (
        <div className="mx-[22px] mb-[22px] rounded-r-lg border-l-[3px] border-ai bg-ai-wash px-3.5 py-3">
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
