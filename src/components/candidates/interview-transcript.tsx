import type { InterviewSessionRow, InterviewScore } from "@/lib/data/interview-sessions";
import type {
  ProctoringIncident,
  ProctoringIncidentType,
  ProctoringSource,
} from "@/lib/proctoring/incidents";

/** The row plus a resolved playback URL for the recording (Phase B2). */
type InterviewSessionView = InterviewSessionRow & {
  recording_signed_url?: string | null;
};

function scoreColor(score: number | null): string {
  if (score == null) return "text-[#9CA3AF]";
  if (score >= 80) return "text-[#059669]";
  if (score >= 60) return "text-[#D97706]";
  return "text-[#DC2626]";
}

/**
 * Recruiter-facing review of the AI video interview: the AI score (Phase B1),
 * the proctoring report (Phase C), the recording (Phase B2), and the spoken
 * transcript. Each is independent evidence shown side by side — per CLAUDE.md
 * there is no rollup. Renders nothing until there's a session worth showing.
 */
export default function InterviewTranscript({
  session,
}: {
  session: InterviewSessionView | null;
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

      <ProctoringBlock session={session} />

      <RecordingBlock session={session} />

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

/** The interview recording (Phase B2). Shows the player once egress has
 *  uploaded the file and a signed URL is available; a plain "processing" note
 *  while the key exists but the object isn't signable yet; nothing when the
 *  interview was never recorded. */
function RecordingBlock({ session }: { session: InterviewSessionView }) {
  if (session.recording_signed_url) {
    return (
      <div className="mb-4">
        <p className="text-xs font-medium text-[#0369A1] uppercase tracking-wider mb-1.5">
          Recording
        </p>
        <video
          controls
          preload="metadata"
          src={session.recording_signed_url}
          className="w-full max-h-[480px] rounded-lg border border-[#E5E7EB] bg-black"
        >
          Your browser does not support playing this recording.
        </video>
      </div>
    );
  }

  if (session.recording_url) {
    return (
      <div className="mb-4 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
        <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wider mb-0.5">
          Recording
        </p>
        <p className="text-xs text-[#9CA3AF]">
          The recording is being processed and will appear here shortly.
        </p>
      </div>
    );
  }

  return null;
}

/** "2 times · 1m 5s" — short enough to sit on one summary row. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

const INCIDENT_LABEL: Record<ProctoringIncidentType, string> = {
  tab_blur: "Left the interview tab",
  camera_off: "Camera off",
  face_absent: "Nobody visible on camera",
  multiple_faces: "More than one person on camera",
};

/**
 * Where a finding came from. Surfaced per incident because the two carry very
 * different weight: browser signals are self-reported by the candidate's machine,
 * while camera findings are a model's reading of the video and can be wrong. A
 * recruiter acting on "more than one person" deserves to know which they are
 * looking at.
 */
const SOURCE_LABEL: Record<ProctoringSource, string> = {
  client: "browser",
  vision: "camera",
};

/** Severity styling. Every level also carries a word and an icon, so severity is
 *  never communicated by colour alone. */
const SEVERITY_STYLE = {
  clean: {
    label: "Clean",
    wrapper: "border-[#A7F3D0] bg-[#ECFDF5]",
    badge: "bg-[#D1FAE5] text-[#047857]",
    heading: "text-[#047857]",
  },
  warning: {
    label: "Warning",
    wrapper: "border-[#FDE68A] bg-[#FFFBEB]",
    badge: "bg-[#FEF3C7] text-[#B45309]",
    heading: "text-[#B45309]",
  },
  critical: {
    label: "Critical",
    wrapper: "border-[#FECACA] bg-[#FEF2F2]",
    badge: "bg-[#FEE2E2] text-[#DC2626]",
    heading: "text-[#DC2626]",
  },
} as const;

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

/**
 * The proctoring report (Phases C + C2): what the candidate's browser observed
 * during the call, plus what a vision model read off their camera. Deliberately
 * presented as *evidence beside* the score, never folded into it — proctoring
 * never terminates an interview or moves an application, so the recruiter reads
 * it and decides. Camera findings are labelled as such and carry an explicit
 * fallibility note, because acting on a wrong one is the expensive mistake here.
 */
function ProctoringBlock({ session }: { session: InterviewSessionView }) {
  const report = session.proctoring;

  // Absent report ≠ clean run. Say so plainly once the interview is over, so a
  // recruiter doesn't read silence as a clean bill of health.
  if (!report) {
    if (session.status !== "completed") return null;
    return (
      <div className="mb-4 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
        <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wider mb-0.5">
          Proctoring
        </p>
        <p className="text-xs text-[#9CA3AF]">
          No proctoring data was captured for this interview.
        </p>
      </div>
    );
  }

  const severity = report.summary.overall_severity;
  const style = SEVERITY_STYLE[severity];
  const clean = severity === "clean";

  return (
    <div className={`mb-4 rounded-lg border p-3 ${style.wrapper}`}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className={`text-xs font-medium uppercase tracking-wider ${style.heading}`}>
          Proctoring
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}
        >
          {clean ? <CheckIcon /> : <AlertIcon />}
          {style.label}
        </span>
      </div>

      {clean ? (
        <p className="text-sm text-[#4B5563] leading-relaxed">
          The candidate stayed on the interview tab with their camera on throughout.
          {report.summary.vision_sampled
            ? " Camera checks found one person present."
            : " The camera itself was not analysed for this interview."}
        </p>
      ) : (
        <>
          <dl className="space-y-1">
            <IncidentRow
              label={INCIDENT_LABEL.tab_blur}
              count={report.summary.tab_blur_count}
              totalMs={report.summary.tab_blur_total_ms}
            />
            <IncidentRow
              label={INCIDENT_LABEL.camera_off}
              count={report.summary.camera_off_count}
              totalMs={report.summary.camera_off_total_ms}
            />
            <IncidentRow
              label={INCIDENT_LABEL.face_absent}
              count={report.summary.face_absent_count}
              totalMs={report.summary.face_absent_total_ms}
            />
            <IncidentRow
              label={INCIDENT_LABEL.multiple_faces}
              count={report.summary.multiple_faces_count}
              totalMs={report.summary.multiple_faces_total_ms}
            />
          </dl>

          {report.incidents.length > 0 && (
            <details className="mt-2 group">
              <summary className="text-xs font-medium text-[#0369A1] cursor-pointer hover:text-[#0C4A6E] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-1 rounded">
                View timeline ({report.incidents.length})
              </summary>
              <ol className="mt-1.5 space-y-1">
                {report.incidents.map((incident, i) => (
                  <IncidentTimelineRow key={`${incident.at}-${i}`} incident={incident} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      <p className="mt-2 text-[11px] text-[#6B7280] leading-relaxed">
        Recorded for context only — proctoring does not affect the interview score or the
        candidate&apos;s stage. Camera findings are automated estimates and can be wrong;
        review the recording before acting on one.
      </p>
    </div>
  );
}

/** One "Camera off — 2 times · 45s" summary row. Hidden when it never happened. */
function IncidentRow({
  label,
  count,
  totalMs,
}: {
  label: string;
  count: number;
  totalMs: number;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-[#4B5563]">{label}</dt>
      <dd className="text-sm text-[#4B5563] tabular-nums shrink-0">
        <span className="font-semibold">{count}</span> {count === 1 ? "time" : "times"} ·{" "}
        {formatDuration(totalMs)}
      </dd>
    </div>
  );
}

function IncidentTimelineRow({ incident }: { incident: ProctoringIncident }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs text-[#6B7280]">
      <span className="tabular-nums shrink-0">{formatTime(incident.at)}</span>
      <span className="flex-1 truncate">
        {INCIDENT_LABEL[incident.type]}
        <span className="ml-1.5 text-[#9CA3AF]">({SOURCE_LABEL[incident.source]})</span>
      </span>
      <span className="tabular-nums shrink-0">
        {formatDuration(incident.duration_ms)}
        {incident.severity === "critical" && (
          <span className="ml-1.5 font-semibold text-[#DC2626]">Critical</span>
        )}
      </span>
    </li>
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
