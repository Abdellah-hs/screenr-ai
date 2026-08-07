import type {
  ProctoringIncident,
  ProctoringIncidentType,
  ProctoringReport,
  ProctoringSource,
} from "@/lib/proctoring/incidents";

/**
 * The recruiter-facing proctoring panel, shared by the AI video interview and
 * the voice screening.
 *
 * Shared deliberately: both stages run the same `summarizeProctoring` rules, so
 * rendering them through one component means a report reads identically wherever
 * it came from, and a wording change to how findings are qualified can't land on
 * one stage and miss the other.
 *
 * The stages differ in what evidence they can even have. The interview has a
 * camera, so it carries server-side vision findings the candidate cannot forge.
 * Screening is voice-only: tab focus is all there is, and it is self-reported by
 * the candidate's own browser. `stage` exists to keep that distinction visible
 * rather than letting a clean screening report imply more than it can.
 *
 * Presented as evidence BESIDE the score, never folded into it — proctoring
 * never terminates a call, moves an application, or affects a score.
 */

export type ProctoringStage = "interview" | "screening";

export function ProctoringReportPanel({
  report,
  stage,
  /** Show the "nothing captured" note. Pass false while the stage is unfinished. */
  showWhenAbsent,
}: {
  report: ProctoringReport | null;
  stage: ProctoringStage;
  showWhenAbsent: boolean;
}) {
  const noun = stage === "interview" ? "interview" : "screening";

  // Absent report is NOT a clean run. Say so plainly, so a recruiter doesn't
  // read silence as a clean bill of health.
  if (!report) {
    if (!showWhenAbsent) return null;
    return (
      <div className="mb-4 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
        <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wider mb-0.5">
          Proctoring
        </p>
        <p className="text-xs text-[#9CA3AF]">
          No proctoring data was captured for this {noun}.
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
        <CleanSummary report={report} stage={stage} />
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

      <Caveat stage={stage} />
    </div>
  );
}

/** What "clean" actually means differs by stage — say which. */
function CleanSummary({
  report,
  stage,
}: {
  report: ProctoringReport;
  stage: ProctoringStage;
}) {
  if (stage === "screening") {
    return (
      <p className="text-sm text-[#4B5563] leading-relaxed">
        The candidate stayed on the screening tab throughout.
      </p>
    );
  }
  return (
    <p className="text-sm text-[#4B5563] leading-relaxed">
      The candidate stayed on the interview tab with their camera on throughout.
      {report.summary.vision_sampled
        ? " Camera checks found one person present."
        : " The camera itself was not analysed for this interview."}
    </p>
  );
}

/**
 * The limits, stated where the finding is read rather than buried in docs. The
 * screening wording is blunter on purpose: with no camera there is nothing
 * server-side to corroborate the browser's report, so a clean screening result
 * is weak evidence and a recruiter should not treat it as clearance.
 */
function Caveat({ stage }: { stage: ProctoringStage }) {
  if (stage === "screening") {
    return (
      <p className="mt-2 text-[11px] text-[#6B7280] leading-relaxed">
        Recorded for context only — proctoring does not affect the screening score or the
        candidate&apos;s stage. These signals come from the candidate&apos;s own browser, so a
        clean result is not proof: someone using a second device, or notes on paper, leaves
        no trace here.
      </p>
    );
  }
  return (
    <p className="mt-2 text-[11px] text-[#6B7280] leading-relaxed">
      Recorded for context only — proctoring does not affect the interview score or the
      candidate&apos;s stage. Camera findings are automated estimates and can be wrong;
      review the recording before acting on one.
    </p>
  );
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
