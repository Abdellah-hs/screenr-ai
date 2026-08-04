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
 *   and runs a local object detector over them, reporting raw
 *   `VisionObservation`s — how many people and how many phones were in shot at a
 *   sampled instant, plus how usable that frame was. This is server-side
 *   evidence the candidate's machine cannot forge, but it is a model inference,
 *   so it carries confidence and is never treated as fact. The frames themselves
 *   are never stored: the interview is not recorded, and this report is the only
 *   thing that outlives the call.
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
 * incident and low-confidence samples are discarded rather than guessed at. That
 * bias matters more now that there is no recording: nobody can go check the
 * footage, so a finding must be worth stating on its own.
 */

/** Bump when the thresholds below change, so old reports stay interpretable. */
export const PROCTORING_REPORT_VERSION = "proctoring-v3";

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
export const PERSON_ABSENT_MIN_MS = 15_000;

/** A full minute with no one in front of the camera. */
export const PERSON_ABSENT_CRITICAL_MS = 60_000;

/**
 * A second person in frame. Deliberately longer than the ~10s sampling interval,
 * so it takes THREE consecutive sightings rather than two: someone walking
 * behind the candidate, or a person on a poster caught at one angle, lands in
 * one or two frames and must not raise an incident.
 */
export const MULTIPLE_PEOPLE_MIN_MS = 15_000;

/** A second person present persistently, not passing through. */
export const MULTIPLE_PEOPLE_CRITICAL_MS = 30_000;

/**
 * A phone in shot. Same three-sightings logic as `multiple_people`: a phone face
 * down on the desk catches the light in one frame, and a candidate silencing a
 * call is not cheating. Only a device that stays in view long enough to be read
 * from is worth reporting.
 */
export const PHONE_VISIBLE_MIN_MS = 15_000;

/** A phone held in view long enough to work from, not just moved out of the way. */
export const PHONE_VISIBLE_CRITICAL_MS = 30_000;

/**
 * Vision samples below this frame-usability score are DISCARDED rather than
 * believed: a dark room or a blurred frame must not read as "the candidate
 * left". Dropping them also breaks the run, so uncertainty can never accumulate
 * into an incident.
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
 * cannot post a `person_absent` (or, more to the point, suppress one).
 */
export type VisionIncidentType =
  | "person_absent"
  | "multiple_people"
  | "phone_visible";

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
 * One sampled video frame, as judged by the worker's object detector. Raw
 * evidence: counts and a usability score, never a verdict about the candidate.
 */
export interface VisionObservation {
  /** ISO timestamp of the sampled frame. */
  at: string;
  /** How many people the detector found. 0 = nobody in shot. */
  person_count: number;
  /**
   * How usable the frame was as evidence, 0–1 — the detector's own confidence in
   * what it counted, floored by frame quality (a dark or flat frame scores low).
   * A detector cannot say "I couldn't see"; this is the worker's stand-in for it,
   * and it is what keeps an unlit room from reading as an empty one.
   */
  confidence: number;
  /** How many phones/handheld devices were in shot. 0 = none. */
  phone_count: number;
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
  person_absent_count: number;
  person_absent_total_ms: number;
  multiple_people_count: number;
  multiple_people_total_ms: number;
  phone_visible_count: number;
  phone_visible_total_ms: number;
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
  person_absent: {
    minMs: PERSON_ABSENT_MIN_MS,
    criticalMs: PERSON_ABSENT_CRITICAL_MS,
  },
  multiple_people: {
    minMs: MULTIPLE_PEOPLE_MIN_MS,
    criticalMs: MULTIPLE_PEOPLE_CRITICAL_MS,
  },
  phone_visible: {
    minMs: PHONE_VISIBLE_MIN_MS,
    criticalMs: PHONE_VISIBLE_CRITICAL_MS,
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

/**
 * Which conditions a single usable sample represents. A frame can carry more
 * than one — a second person AND a phone is a perfectly ordinary reading, and
 * collapsing it to whichever came first would silently drop half the evidence.
 * `person_absent` and `multiple_people` are the only mutually exclusive pair,
 * because they are two ends of the same count.
 */
function conditionsOf(observation: VisionObservation): VisionIncidentType[] {
  const conditions: VisionIncidentType[] = [];
  if (observation.person_count === 0) conditions.push("person_absent");
  else if (observation.person_count >= 2) conditions.push("multiple_people");
  if (observation.phone_count >= 1) conditions.push("phone_visible");
  return conditions;
}

const VISION_CONDITIONS: readonly VisionIncidentType[] = [
  "person_absent",
  "multiple_people",
  "phone_visible",
];

/**
 * Collapse periodic frame samples into durations.
 *
 * A run is consecutive usable samples in which one condition holds, tracked
 * INDEPENDENTLY per condition so overlapping findings don't cannibalise each
 * other. A run's duration spans first to last sample, so a SINGLE stray frame is
 * always zero-length and can never clear a threshold — the property that keeps
 * one bad inference from accusing a candidate. Unusable (low-confidence) samples
 * are dropped and break every run rather than extending them, and a gap longer
 * than `VISION_MAX_SAMPLE_GAP_MS` also breaks a run, so a stalled worker can't
 * be read as a minute of absence.
 */
function visionIncidents(observations: VisionObservation[]): ProctoringIncident[] {
  const usable = observations
    .filter((o) => o.confidence >= VISION_MIN_CONFIDENCE)
    .map((o) => ({ ...o, ts: Date.parse(o.at) }))
    .filter((o) => !Number.isNaN(o.ts))
    .sort((a, b) => a.ts - b.ts);

  const incidents: ProctoringIncident[] = [];
  const runs = new Map<VisionIncidentType, { startTs: number; lastTs: number }>();

  const closeRun = (type: VisionIncidentType) => {
    const run = runs.get(type);
    if (!run) return;
    runs.delete(type);
    const incident = classify(
      type,
      new Date(run.startTs).toISOString(),
      run.lastTs - run.startTs,
      "vision",
    );
    if (incident) incidents.push(incident);
  };

  for (const sample of usable) {
    const active = new Set(conditionsOf(sample));

    for (const type of VISION_CONDITIONS) {
      const run = runs.get(type);

      if (!active.has(type)) {
        closeRun(type);
        continue;
      }

      if (run && sample.ts - run.lastTs <= VISION_MAX_SAMPLE_GAP_MS) {
        run.lastTs = sample.ts;
      } else {
        // Either nothing open, or the gap is too wide to be the same run: the
        // old one ends here and a fresh one starts at this sample.
        closeRun(type);
        runs.set(type, { startTs: sample.ts, lastTs: sample.ts });
      }
    }
  }

  for (const type of VISION_CONDITIONS) closeRun(type);

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
  const personAbsent = totalFor(incidents, "person_absent");
  const multiplePeople = totalFor(incidents, "multiple_people");
  const phoneVisible = totalFor(incidents, "phone_visible");

  return {
    incidents,
    summary: {
      tab_blur_count: tabBlur.count,
      tab_blur_total_ms: tabBlur.totalMs,
      camera_off_count: cameraOff.count,
      camera_off_total_ms: cameraOff.totalMs,
      person_absent_count: personAbsent.count,
      person_absent_total_ms: personAbsent.totalMs,
      multiple_people_count: multiplePeople.count,
      multiple_people_total_ms: multiplePeople.totalMs,
      phone_visible_count: phoneVisible.count,
      phone_visible_total_ms: phoneVisible.totalMs,
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
