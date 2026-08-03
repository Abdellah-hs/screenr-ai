/**
 * Pure proctoring rules for the AI video interview (Phase C).
 *
 * The candidate's browser is the only thing that can observe tab focus and the
 * local camera, so it reports RAW events (`ProctoringEvent`) — what happened and
 * for how long. It never asserts how bad an event is. This module owns that
 * judgement server-side: it drops sub-threshold noise and classifies what's left
 * into `warning` / `critical` incidents.
 *
 * Keeping the thresholds here (rather than in the component) means client-reported
 * evidence can't inflate or hide its own severity, and the ruleset is versioned
 * (`PROCTORING_REPORT_VERSION`) so a stored report stays traceable to the rules
 * that produced it — the same "AI output is evidence, not truth" discipline
 * CLAUDE.md applies to scores, extended to browser signals.
 *
 * Per the V1 scope this is observational only: nothing here terminates an
 * interview or feeds the interview score. Recruiters read it as separate evidence.
 */

/** Bump when the thresholds below change, so old reports stay interpretable. */
export const PROCTORING_REPORT_VERSION = "proctoring-v1";

/**
 * A camera gap must last this long to count. Below it the "gap" is almost always
 * a track renegotiation or a device hiccup, not the candidate leaving.
 */
export const CAMERA_OFF_MIN_MS = 5_000;

/** Sustained absence from camera — the candidate is meaningfully gone. */
export const CAMERA_OFF_CRITICAL_MS = 30_000;

/**
 * A tab blur must last this long to count. Browsers fire blur for things the
 * candidate didn't do (an OS notification stealing focus, a permission prompt),
 * so anything under a second is discarded as noise.
 */
export const TAB_BLUR_MIN_MS = 1_000;

/** Sustained time off the interview tab — long enough to consult something. */
export const TAB_BLUR_CRITICAL_MS = 10_000;

export type ProctoringIncidentType = "tab_blur" | "camera_off";

export type ProctoringSeverity = "warning" | "critical";

/** Raw, untrusted observation reported by the candidate's browser. */
export interface ProctoringEvent {
  type: ProctoringIncidentType;
  /** ISO timestamp of when the condition began. */
  at: string;
  /** How long the condition lasted, in milliseconds. */
  duration_ms: number;
}

/** An event that cleared the noise threshold, with its severity decided here. */
export interface ProctoringIncident extends ProctoringEvent {
  severity: ProctoringSeverity;
}

export interface ProctoringSummary {
  tab_blur_count: number;
  tab_blur_total_ms: number;
  camera_off_count: number;
  camera_off_total_ms: number;
  /** Worst single incident — `clean` when nothing cleared the thresholds. */
  overall_severity: ProctoringSeverity | "clean";
}

/** The persisted proctoring report, stored on `interview_sessions.proctoring`. */
export interface ProctoringReport {
  incidents: ProctoringIncident[];
  summary: ProctoringSummary;
  report_version: string;
  generated_at: string;
}

const THRESHOLDS: Record<
  ProctoringIncidentType,
  { minMs: number; criticalMs: number }
> = {
  tab_blur: { minMs: TAB_BLUR_MIN_MS, criticalMs: TAB_BLUR_CRITICAL_MS },
  camera_off: { minMs: CAMERA_OFF_MIN_MS, criticalMs: CAMERA_OFF_CRITICAL_MS },
};

function classify(event: ProctoringEvent): ProctoringIncident | null {
  const { minMs, criticalMs } = THRESHOLDS[event.type];
  if (event.duration_ms < minMs) return null;
  return {
    ...event,
    severity: event.duration_ms >= criticalMs ? "critical" : "warning",
  };
}

function totalFor(
  incidents: ProctoringIncident[],
  type: ProctoringIncidentType,
): { count: number; totalMs: number } {
  const matching = incidents.filter((i) => i.type === type);
  return {
    count: matching.length,
    totalMs: matching.reduce((sum, i) => sum + i.duration_ms, 0),
  };
}

/**
 * Turn raw browser observations into the persisted proctoring report: filter out
 * sub-threshold noise, classify severity, and roll up per-type counts. Pure — no
 * I/O, no clock dependency beyond the report's own timestamp.
 */
export function summarizeProctoring(events: ProctoringEvent[]): ProctoringReport {
  const incidents = events
    .map(classify)
    .filter((i): i is ProctoringIncident => i !== null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const tabBlur = totalFor(incidents, "tab_blur");
  const cameraOff = totalFor(incidents, "camera_off");

  return {
    incidents,
    summary: {
      tab_blur_count: tabBlur.count,
      tab_blur_total_ms: tabBlur.totalMs,
      camera_off_count: cameraOff.count,
      camera_off_total_ms: cameraOff.totalMs,
      overall_severity: incidents.some((i) => i.severity === "critical")
        ? "critical"
        : incidents.length > 0
          ? "warning"
          : "clean",
    },
    report_version: PROCTORING_REPORT_VERSION,
    generated_at: new Date().toISOString(),
  };
}
