/**
 * Pure proctoring rules for the AI video interview (Phases C and C2).
 *
 * Evidence arrives from two places, and the difference matters:
 *
 * - The candidate's BROWSER is the only thing that can observe tab focus and the
 *   local camera track, so it reports raw `ProctoringEvent`s — what happened and
 *   for how long. It is untrusted: it can lie by omission, and it never asserts
 *   how bad an event is.
 * - The agent WORKER samples frames from the candidate's published video track
 *   and runs a vision model over them, reporting raw `VisionObservation`s — a
 *   face count per sampled instant, with the model's confidence. This is
 *   server-side evidence the candidate's machine cannot forge, but it is a model
 *   inference, so it carries confidence and is never treated as fact.
 *
 * This module owns the judgement for both: it drops sub-threshold noise and
 * classifies what survives into `warning` / `critical` incidents. Keeping the
 * thresholds here (rather than in the component or the worker) means neither the
 * client nor the model can inflate or hide its own severity, and the ruleset is
 * versioned (`PROCTORING_REPORT_VERSION`) so a stored report stays traceable to
 * the rules that produced it — the same "AI output is evidence, not truth"
 * discipline CLAUDE.md applies to scores.
 *
 * Observational only: nothing here terminates an interview, transitions an
 * application, or feeds the interview score. Recruiters read it as separate
 * evidence beside the score. Vision inference in particular is deliberately
 * conservative — a wrong "someone else was present" is far more costly to a real
 * candidate than a missed one, so single stray frames can never raise an
 * incident and low-confidence samples are discarded rather than guessed at.
 */

/** Bump when the thresholds below change, so old reports stay interpretable. */
export const PROCTORING_REPORT_VERSION = "proctoring-v2";

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

/**
 * Nobody detectable in frame. Generous: candidates lean out of shot to think,
 * reach for water, or check a second monitor constantly, and none of that is
 * misconduct. Only sustained absence is worth surfacing.
 */
export const FACE_ABSENT_MIN_MS = 15_000;

/** A full minute with no one in front of the camera. */
export const FACE_ABSENT_CRITICAL_MS = 60_000;

/**
 * A second person in frame. Deliberately longer than the ~10s sampling interval,
 * so it takes THREE consecutive sightings rather than two: someone walking
 * behind the candidate, or a face on a poster caught at one angle, lands in one
 * or two frames and must not raise an incident.
 */
export const MULTIPLE_FACES_MIN_MS = 15_000;

/** A second person present persistently, not passing through. */
export const MULTIPLE_FACES_CRITICAL_MS = 30_000;

/**
 * Vision samples below this model confidence are DISCARDED rather than believed:
 * a dark room or a blurred frame must not read as "the candidate left". Dropping
 * them also breaks the run, so uncertainty can never accumulate into an incident.
 */
export const VISION_MIN_CONFIDENCE = 0.6;

/**
 * Consecutive samples further apart than this don't belong to the same run. The
 * worker samples every ~10s; a longer gap means it stalled or the track dropped,
 * and assuming the condition held throughout would invent evidence.
 */
export const VISION_MAX_SAMPLE_GAP_MS = 30_000;

/** What the candidate's browser can report. Deliberately NOT the vision types. */
export type ProctoringEventType = "tab_blur" | "camera_off";

/**
 * Server-derived types. These are kept out of `ProctoringEventType` on purpose:
 * the client-facing Zod schema is bound to that union, so a candidate's browser
 * cannot post a `face_absent` (or, more to the point, suppress one).
 */
export type VisionIncidentType = "face_absent" | "multiple_faces";

export type ProctoringIncidentType = ProctoringEventType | VisionIncidentType;

export type ProctoringSeverity = "warning" | "critical";

/** Where a piece of evidence came from — surfaced to recruiters, not inferred. */
export type ProctoringSource = "client" | "vision";

/** Raw, untrusted observation reported by the candidate's browser. */
export interface ProctoringEvent {
  type: ProctoringEventType;
  /** ISO timestamp of when the condition began. */
  at: string;
  /** How long the condition lasted, in milliseconds. */
  duration_ms: number;
}

/**
 * One sampled video frame, as judged by the worker's vision model. Raw evidence:
 * a count and a confidence, never a verdict about the candidate.
 */
export interface VisionObservation {
  /** ISO timestamp of the sampled frame. */
  at: string;
  /** How many faces the model found. 0 = nobody in shot. */
  face_count: number;
  /** Model confidence in this reading, 0–1. */
  confidence: number;
}

/** An event that cleared the noise threshold, with its severity decided here. */
export interface ProctoringIncident {
  type: ProctoringIncidentType;
  /** ISO timestamp of when the condition began. */
  at: string;
  /** How long the condition lasted, in milliseconds. */
  duration_ms: number;
  severity: ProctoringSeverity;
  source: ProctoringSource;
}

export interface ProctoringSummary {
  tab_blur_count: number;
  tab_blur_total_ms: number;
  camera_off_count: number;
  camera_off_total_ms: number;
  face_absent_count: number;
  face_absent_total_ms: number;
  multiple_faces_count: number;
  multiple_faces_total_ms: number;
  /**
   * Whether vision sampling produced any usable frames at all. Distinguishes
   * "the camera was watched and looked fine" from "nobody was watching" — an
   * interview with no vision evidence must not read as a clean one.
   */
  vision_sampled: boolean;
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
  face_absent: { minMs: FACE_ABSENT_MIN_MS, criticalMs: FACE_ABSENT_CRITICAL_MS },
  multiple_faces: {
    minMs: MULTIPLE_FACES_MIN_MS,
    criticalMs: MULTIPLE_FACES_CRITICAL_MS,
  },
};

function classify(
  type: ProctoringIncidentType,
  at: string,
  durationMs: number,
  source: ProctoringSource,
): ProctoringIncident | null {
  const { minMs, criticalMs } = THRESHOLDS[type];
  if (durationMs < minMs) return null;
  return {
    type,
    at,
    duration_ms: durationMs,
    severity: durationMs >= criticalMs ? "critical" : "warning",
    source,
  };
}

/** Which condition, if any, a single usable sample represents. */
function conditionOf(observation: VisionObservation): VisionIncidentType | null {
  if (observation.face_count === 0) return "face_absent";
  if (observation.face_count >= 2) return "multiple_faces";
  return null; // exactly one face — the expected state
}

/**
 * Collapse periodic frame samples into durations.
 *
 * A run is consecutive usable samples sharing one condition. Its duration spans
 * first to last sample, so a SINGLE stray frame is always zero-length and can
 * never clear a threshold — the property that keeps one bad inference from
 * accusing a candidate. Unusable (low-confidence) samples are dropped and break
 * the run rather than extending it, and a gap longer than
 * `VISION_MAX_SAMPLE_GAP_MS` also breaks it, so a stalled worker can't be read
 * as a minute of absence.
 */
function visionIncidents(observations: VisionObservation[]): ProctoringIncident[] {
  const usable = observations
    .filter((o) => o.confidence >= VISION_MIN_CONFIDENCE)
    .map((o) => ({ ...o, ts: Date.parse(o.at) }))
    .filter((o) => !Number.isNaN(o.ts))
    .sort((a, b) => a.ts - b.ts);

  const incidents: ProctoringIncident[] = [];
  let run: { type: VisionIncidentType; startTs: number; lastTs: number } | null = null;

  const closeRun = () => {
    if (!run) return;
    const incident = classify(
      run.type,
      new Date(run.startTs).toISOString(),
      run.lastTs - run.startTs,
      "vision",
    );
    if (incident) incidents.push(incident);
    run = null;
  };

  for (const sample of usable) {
    const condition = conditionOf(sample);
    const continues =
      run !== null &&
      run.type === condition &&
      sample.ts - run.lastTs <= VISION_MAX_SAMPLE_GAP_MS;

    if (continues) {
      run!.lastTs = sample.ts;
      continue;
    }

    closeRun();
    if (condition) run = { type: condition, startTs: sample.ts, lastTs: sample.ts };
  }
  closeRun();

  return incidents;
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
 * Turn raw evidence into the persisted proctoring report: filter out
 * sub-threshold noise, classify severity, and roll up per-type counts. Pure — no
 * I/O, no clock dependency beyond the report's own timestamp.
 *
 * `events` are the candidate browser's observations; `observations` are the
 * worker's vision samples. Both are optional and independent — an interview may
 * have either, both, or neither (no worker running, vision unconfigured), and
 * `summary.vision_sampled` records which, so absent evidence is never rendered
 * as clean evidence.
 */
export function summarizeProctoring(
  events: ProctoringEvent[],
  observations: VisionObservation[] = [],
): ProctoringReport {
  const clientIncidents = events
    .map((e) => classify(e.type, e.at, e.duration_ms, "client"))
    .filter((i): i is ProctoringIncident => i !== null);

  const incidents = [...clientIncidents, ...visionIncidents(observations)].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );

  const tabBlur = totalFor(incidents, "tab_blur");
  const cameraOff = totalFor(incidents, "camera_off");
  const faceAbsent = totalFor(incidents, "face_absent");
  const multipleFaces = totalFor(incidents, "multiple_faces");

  return {
    incidents,
    summary: {
      tab_blur_count: tabBlur.count,
      tab_blur_total_ms: tabBlur.totalMs,
      camera_off_count: cameraOff.count,
      camera_off_total_ms: cameraOff.totalMs,
      face_absent_count: faceAbsent.count,
      face_absent_total_ms: faceAbsent.totalMs,
      multiple_faces_count: multipleFaces.count,
      multiple_faces_total_ms: multipleFaces.totalMs,
      vision_sampled: observations.some((o) => o.confidence >= VISION_MIN_CONFIDENCE),
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
