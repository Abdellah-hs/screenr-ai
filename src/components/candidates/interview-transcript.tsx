import type { InterviewSessionRow } from "@/lib/data/interview-sessions";

/**
 * Recruiter-facing review of the AI video interview: the spoken transcript plus
 * a status line. Per-section scoring, the recording, and the proctoring report
 * are later phases — this card is the Phase A window into what the candidate
 * actually said. Renders nothing until there's a session worth showing.
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
