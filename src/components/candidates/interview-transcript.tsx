import type { InterviewSessionRow, InterviewScore } from "@/lib/data/interview-sessions";
import { ProctoringReportPanel } from "./proctoring-report";

function scoreColor(score: number | null): string {
  if (score == null) return "text-[#9CA3AF]";
  if (score >= 80) return "text-[#059669]";
  if (score >= 60) return "text-[#D97706]";
  return "text-[#DC2626]";
}

/**
 * Recruiter-facing review of the AI video interview: the AI score (Phase B1),
 * the proctoring report (Phase C), and the spoken transcript. Each is
 * independent evidence shown side by side — per CLAUDE.md there is no rollup.
 * Renders nothing until there's a session worth showing.
 *
 * The interview is never recorded, so the transcript and the proctoring report
 * are the entire record of the call — which is exactly why the proctoring panel
 * carries a fallibility note rather than pointing at footage to check.
 */
export default function InterviewTranscript({
  session,
}: {
  session: InterviewSessionRow | null;
}) {
  // Nothing to review until the candidate has at least started. An `invited`
  // session with an empty transcript is just a pending link — the pipeline
  // stage already communicates that, so this card stays hidden.
  if (!session) return null;
  const transcript = session.transcript ?? [];
  if (session.status === "invited" && transcript.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider">
            AI Video Interview
          </h2>
          <StatusLine session={session} />
        </div>
      </div>

      {session.scores && <InterviewScoreBlock score={session.scores} />}

      <ProctoringReportPanel
        report={session.proctoring}
        stage="interview"
        showWhenAbsent={session.status === "completed"}
      />

      {transcript.length > 0 ? (
        <ol className="space-y-2">
          {transcript.map((turn, i) => {
            const isAgent = turn.role === "agent";
            return (
              <li
                key={`${turn.at}-${i}`}
                className={`rounded-lg border p-2.5 ${
                  isAgent
                    ? "border-[#BAE6FD] bg-[#F0F9FF]"
                    : "border-[#E5E7EB] bg-[#F9FAFB]"
                }`}
              >
                <span
                  className={`block text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${
                    isAgent ? "text-[#0369A1]" : "text-[#6B7280]"
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

/** The AI interview score: overall + strengths/concerns + per-competency bars.
 *  Independent stage evidence — richer than the generic score card because it
 *  carries the interviewer's strengths/concerns (PRD interview outputs). */
function InterviewScoreBlock({ score }: { score: InterviewScore }) {
  return (
    <div className="mb-4 rounded-lg bg-[#F0F9FF] border border-[#BAE6FD] p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[#0369A1] uppercase tracking-wider">
          Interview Score
        </span>
        <span className={`text-2xl font-bold ${scoreColor(score.overall_score)}`}>
          {score.overall_score}
        </span>
      </div>
      {score.overall_rationale && (
        <p className="text-sm text-[#4B5563] leading-relaxed">{score.overall_rationale}</p>
      )}

      {score.dimensions.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {score.dimensions.map((d, i) => (
            <div key={`${d.name}-${i}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#6B7280]" title={d.rationale}>
                  {d.name}
                </span>
                <span className="text-xs font-semibold text-[#0C4A6E]">{d.score}</span>
              </div>
              <div className="w-full h-1.5 bg-[#E0F2FE] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    d.score >= 80 ? "bg-[#22C55E]" : d.score >= 60 ? "bg-[#D97706]" : "bg-[#DC2626]"
                  }`}
                  style={{ width: `${d.score}%` }}
                />
              </div>
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
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusLine({ session }: { session: InterviewSessionRow }) {
  switch (session.status) {
    case "invited":
      return <p className="text-xs text-[#6B7280] mt-1">Invited · Awaiting the candidate</p>;
    case "in_progress":
      return <p className="text-xs text-[#6B7280] mt-1">In progress…</p>;
    case "completed":
      return (
        <p className="text-xs text-[#6B7280] mt-1">
          Completed {formatDate(session.completed_at)}
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
