import type { InterviewScore } from "@/lib/data/interview-sessions";
import type { InterviewSessionView } from "@/lib/actions/interview";
import { AiCaption, AiEyebrow, AiRail } from "@/components/ui/ai-attribution";
import { STAGE_ASSESSMENT_COPY } from "@/lib/candidates/detail-header";
import { formatEvidenceTimestamp } from "@/lib/utils";
import {
  EvidenceExcerpt,
  TURN_TARGET_HIGHLIGHT,
  transcriptTurnId,
} from "./score-evidence";
import InterviewEvaluation from "./interview-evaluation";
import { RescoreInterviewButton } from "./rescore-interview-button";

/** Anchor namespace for this transcript, so screening links can never collide. */
const ANCHOR = "interview";

/**
 * Recruiter-facing review of the AI video interview: the AI score (Phase B1)
 * and the spoken transcript. Renders nothing until there is a session worth
 * showing.
 *
 * The proctoring report (Phase C) is deliberately NOT here. It is its own view
 * under this stage in the evidence nav, because it is a different kind of
 * evidence about the same sitting — per CLAUDE.md it is observational only,
 * never fed into the score — and folding it into the score card is how the two
 * start to read as one verdict.
 *
 * The interview is never recorded, so the transcript, the proctoring report, and
 * the single frames captured for each camera finding are the entire record of
 * the call.
 */
export default function InterviewTranscript({
  session,
  applicationId,
  campaignActive = false,
}: {
  session: InterviewSessionView | null;
  applicationId: string;
  /** Re-scoring is processing, so it is frozen unless the campaign is Active. */
  campaignActive?: boolean;
}) {
  // The caller decides whether this stage happened — `interviewWasTaken` in
  // `detail-header.ts` — and renders a named absence in this card's place when
  // it did not. Returning null here as well would be a second copy of that
  // condition, and the failure when the two drift is silent: a panel rendered
  // over nothing, with no absence card and nothing to say why.
  if (!session) return null;
  const transcript = session.transcript ?? [];

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
            AI Video Interview
          </h2>
          <StatusLine session={session} />
        </div>
        {/* Only once there is a finished interview to re-read. Sits beside the
            heading rather than in the score block, because it is still useful
            when a score failed to write at all. */}
        {session.status === "completed" && (
          <RescoreInterviewButton
            applicationId={applicationId}
            campaignActive={campaignActive}
          />
        )}
      </div>

      {session.scores && <InterviewScoreBlock score={session.scores} />}

      {/* The rubric breakdown, for interviews scored on evidence levels. Null
          `dimension_scores` means the retired numeric prompt produced this
          score, and `InterviewScoreBlock` renders those from `dimensions`
          instead — a score shows the unit it was actually graded in. */}
      {session.scores?.dimension_scores && session.scores.dimension_scores.length > 0 && (
        <div className="mb-4">
          <InterviewEvaluation
            dimensions={session.scores.dimension_scores}
            coveredCount={session.scores.covered_count}
            coveredWeight={session.scores.covered_weight}
            usedDefaultRubric={session.scores.dimension_scores.some((d) =>
              d.dimension_id.startsWith("default:"),
            )}
          />
        </div>
      )}

      {transcript.length > 0 ? (
        <ol className="space-y-2">
          {transcript.map((turn, i) => {
            const isAgent = turn.role === "agent";
            return (
              <li
                key={`${turn.at}-${i}`}
                id={transcriptTurnId(ANCHOR, i)}
                className={`rounded-lg border p-2.5 transition-colors ${TURN_TARGET_HIGHLIGHT} ${
                  isAgent
                    ? "border-[#C7D2FE] bg-[#FAFAFF]"
                    : "border-[#E5E7EB] bg-[#F9FAFB]"
                }`}
              >
                <span
                  className={`block text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${
                    isAgent ? "text-[#4338CA]" : "text-[#6B7280]"
                  }`}
                >
                  {isAgent ? "Interviewer" : "Candidate"}
                </span>
                <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap">
                  {turn.text}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs text-[#9CA3AF] italic">
          {session.status === "in_progress"
            ? "Interview in progress…"
            : "No transcript was captured for this interview."}
        </p>
      )}
    </div>
  );
}

/**
 * The AI interview score: overall + strengths/concerns + per-competency bars.
 *
 * Its own component rather than a `ScoreSection` because it carries more than
 * that card can hold — the interviewer's strengths and concerns are PRD
 * interview outputs and have no equivalent at the earlier stages. What it
 * borrows back are the two things that are not optional: the indigo rail, and
 * the caption that says a model wrote the number and that the number moved
 * nobody. It had neither, which made this — the most consequential AI reading
 * in the product, and the only one whose evidence has no recording behind it —
 * the single score on the candidate file that read as a fact.
 *
 * The overall is ink, like the other two. Grading the figure itself in red or
 * green would make colour say "good/bad" here and "who produced this" three
 * panels away; the per-competency bars carry the verdict instead, in the same
 * three tones `ScoreSection` uses.
 */
function InterviewScoreBlock({ score }: { score: InterviewScore }) {
  const copy = STAGE_ASSESSMENT_COPY.interview;

  return (
    <AiRail className="mb-4">
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between mb-1">
          <AiEyebrow>{copy.eyebrow}</AiEyebrow>
          <span className="text-2xl font-semibold tabular-nums tracking-[-0.025em] text-ink">
            {score.overall_score}
            <span className="ml-1 text-sm font-normal text-[#9CA3AF]">/ 100</span>
          </span>
        </div>
        {score.overall_rationale && (
          <p className="text-sm text-[#4B5563] leading-relaxed">{score.overall_rationale}</p>
        )}

        {!score.dimension_scores && score.dimensions.length > 0 && (
          <div className="mt-3 space-y-2.5">
            {score.dimensions.map((d, i) => (
              <div key={`${d.name}-${i}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#6B7280]" title={d.rationale}>
                    {d.name}
                  </span>
                  <span className="text-xs font-semibold text-[#111827]">{d.score}</span>
                </div>
                <div className="w-full h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      d.score >= 80
                        ? "bg-[#059669]"
                        : d.score >= 60
                          ? "bg-[#D97706]"
                          : "bg-[#DC2626]"
                    }`}
                    style={{ width: `${d.score}%` }}
                  />
                </div>
                <EvidenceExcerpt
                  quote={d.evidence_quote}
                  turnIndex={d.evidence_turn_index}
                  anchorPrefix={ANCHOR}
                  zeroScored={d.score === 0}
                />
              </div>
            ))}
          </div>
        )}

        {(score.strengths.length > 0 || score.concerns.length > 0) && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {score.strengths.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#059669] mb-1">
                  Strengths
                </p>
                <ul className="space-y-0.5">
                  {score.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-[#4B5563] leading-relaxed">
                      + {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {score.concerns.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#DC2626] mb-1">
                  Concerns
                </p>
                <ul className="space-y-0.5">
                  {score.concerns.map((c, i) => (
                    <li key={i} className="text-xs text-[#4B5563] leading-relaxed">
                      − {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <AiCaption
        fallibility={copy.fallibility}
        rubricVersion={score.rubric_version}
        at={formatEvidenceTimestamp(score.scored_at)}
        className="px-4 py-3"
      />
    </AiRail>
  );
}


function StatusLine({ session }: { session: InterviewSessionView }) {
  switch (session.status) {
    case "invited":
      return <p className="text-xs text-[#6B7280] mt-1">Invited · Awaiting the candidate</p>;
    case "in_progress":
      return <p className="text-xs text-[#6B7280] mt-1">In progress…</p>;
    case "completed":
      return (
        <p className="text-xs text-[#6B7280] mt-1">
          Completed {formatEvidenceTimestamp(session.completed_at)}
        </p>
      );
    case "expired":
      return <p className="text-xs text-red-600 mt-1">Link expired before completion</p>;
    case "failed":
      return <p className="text-xs text-red-600 mt-1">Interview did not complete</p>;
    default:
      return null;
  }
}
