/**
 * Vision proctoring for the AI video interview (Phase C2).
 *
 * The candidate publishes a camera track, but the interviewer itself is
 * speech-to-speech and never looks at it. This module is the only thing that
 * does: it samples frames off the live track, runs a local object detector over
 * them (`detector.ts`), and hands the readings back for reporting to the app.
 * Two cadences, documented on the constants below: a fast one for the overlay
 * drawn on the candidate's own self-view, a slower one for what is recorded.
 *
 * Three boundaries are deliberate and load-bearing:
 *
 *  1. It is kept OUT of the interviewer's conversation. Feeding frames into the
 *     Realtime session would make the interviewer react to what it sees ("is
 *     someone there with you?"), which tips off the candidate, derails the
 *     interview, and turns a monitoring signal into an accusation delivered live.
 *     The interviewer stays deaf to this entirely.
 *  2. It reports COUNTS AND CONFIDENCE, never verdicts. Nothing here decides
 *     that a candidate cheated, and no severity threshold lives in this file —
 *     the app's rule layer (`summarizeProctoring`) owns that, so the judgement is
 *     versioned, unit-tested, and identical for every candidate.
 *  3. Frames never leave the process. Detection is local, the interview is not
 *     recorded, and no image is written to disk or sent anywhere. A sampled
 *     frame lives for one function call.
 *
 * Failure is always silent and total: if the model won't load, the track never
 * arrives, or sampling throws, the interview continues untouched and the report
 * simply carries fewer samples. Proctoring must never cost a candidate their
 * interview.
 */
import {
  RoomEvent,
  TrackKind,
  VideoBufferType,
  VideoStream,
  type RemoteTrack,
} from "@livekit/rtc-node";
import type { JobContext } from "@livekit/agents";
import { detectFrame, preloadDetector } from "./detector.js";
import type { OverlayBox } from "./postprocess.js";
import { encodeSnapshot, snapshotBucket } from "./snapshot.js";

/** One sampled frame's reading. Mirrors `VisionObservation` in the app. */
export interface VisionObservation {
  at: string;
  person_count: number;
  confidence: number;
  phone_count: number;
}

/**
 * How often an observation is RECORDED for the proctoring report.
 *
 * This is the RESOLUTION of every stored finding, and it was 10s — which threw
 * away most real ones. An incident's duration is measured first flagged sample
 * to last, so the cadence rounds every finding DOWN to a multiple of itself: at
 * 10s a phone in view for 18 seconds lands on two samples and measures 10s,
 * falls under `PHONE_VISIBLE_MIN_MS` (15s), and is discarded along with the
 * still that was captured for it. A condition had to hold ~20s+ to be seen at
 * all, so an ordinary glance at a phone left no evidence whatsoever.
 *
 * 5s halves that error without touching a single threshold — the bar is still
 * 15 seconds of a condition genuinely holding, and a lone stray frame still
 * spans zero time and can still never accuse anyone. It is close to free
 * because the overlay already runs the detector every second: this only decides
 * how often a reading is KEPT, not how often one is computed.
 *
 * Bounded above by the rules and below by the schema. The app caps a report at
 * 500 observations, and `INTERVIEW_DURATION_MINUTES` is 10 — 120 samples here,
 * so there is room, but driving this at overlay speed would blow that cap on a
 * long call and quietly change what every stored report means. It stays a
 * separate knob from the overlay cadence for exactly that reason.
 */
const SAMPLE_INTERVAL_MS = Number(process.env.VISION_SAMPLE_INTERVAL_MS) || 5_000;

/** Set `VISION_OVERLAY=0` to stop publishing boxes to the candidate's browser. */
const OVERLAY_ENABLED = (process.env.VISION_OVERLAY ?? "1") !== "0";

/**
 * How often frames are scored while the overlay is on.
 *
 * The overlay is why this exists: at the report's own cadence a drawn box is up
 * to five seconds stale, so it sits over where the candidate *used to be* and
 * reads as broken. ~1s tracks a person well enough to look live. The cost is
 * real — ~75ms of CPU per frame, so roughly 7% of a core per concurrent
 * interview instead of 0.7%.
 */
const OVERLAY_INTERVAL_MS = Number(process.env.VISION_OVERLAY_INTERVAL_MS) || 1_000;

/** Data-channel topic the candidate's browser listens on for overlay boxes. */
export const VISION_OVERLAY_TOPIC = "proctoring.boxes";

/** The overlay packet. Ephemeral: published, drawn, and never stored anywhere. */
interface OverlayPacket {
  at: string;
  boxes: OverlayBox[];
}

/** Set `VISION_SNAPSHOTS=0` to stop capturing evidence stills entirely. */
const SNAPSHOTS_ENABLED = (process.env.VISION_SNAPSHOTS ?? "1") !== "0";

/**
 * Minimum gap between stored snapshots of the SAME condition.
 *
 * A phone left on the desk for five minutes is one finding, not three hundred
 * photographs of a candidate — this is what bounds that.
 *
 * Halved from 30s on 2026-08-28, when the incident thresholds dropped to 5s. A
 * finding can now be two samples long, and an image only attaches if a snapshot
 * falls INSIDE the incident's window: at 30s a second brief sighting soon after
 * the first was throttled out and its incident rendered with no picture, which
 * is the failure the threshold change was made to fix. The gap that loses an
 * image shrinks from ~30s to ~15s.
 *
 * It costs transient uploads, not stored images: `attachSnapshots` keeps one
 * still per incident at submit and deletes the rest, so what a finished
 * interview holds is bounded by findings, never by this.
 */
const SNAPSHOT_MIN_INTERVAL_MS =
  Number(process.env.VISION_SNAPSHOT_INTERVAL_MS) || 15_000;

/**
 * How long to wait for a camera track before saying, in the log, that there
 * isn't one. Generous: the candidate has to grant a permission prompt first.
 */
const NO_CAMERA_WARN_MS = 30_000;

/** A single frame lifted off the live track, in RGBA. */
interface RawFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * How long to wait for one frame off a subscribed track before giving up.
 *
 * A muted camera keeps its subscription and simply stops sending, with no
 * end-of-stream to read — so an unbounded `read()` stays pending for as long as
 * the mute lasts, and the `busy` flag it is holding stops every later tick. The
 * detector has had a timeout since it was written (`DETECT_TIMEOUT_MS`); this is
 * the same reasoning one step earlier in the pipeline. Comfortably longer than
 * any real inter-frame gap, so it only ever fires on a genuine stall.
 */
const FRAME_CAPTURE_TIMEOUT_MS = 5_000;

/** Grab one frame off the track and hand back raw pixels. */
async function captureFrame(track: RemoteTrack): Promise<RawFrame | null> {
  const stream = new VideoStream(track);
  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) => {
        timer = setTimeout(() => {
          console.error(
            `vision: no frame within ${FRAME_CAPTURE_TIMEOUT_MS}ms — camera muted or stalled`,
          );
          resolve({ value: undefined, done: true });
        }, FRAME_CAPTURE_TIMEOUT_MS);
      }),
    ]);
    if (done || !value) return null;

    // The wire format varies by codec/browser (I420 in practice); converting to
    // RGBA here means the detector only ever deals with one layout. `convert`
    // already returns a freshly-owned buffer, so copying it again would be
    // ~3.7MB of pointless churn per frame at 720p.
    const rgba = value.frame.convert(VideoBufferType.RGBA);
    return { data: rgba.data, width: rgba.width, height: rgba.height };
  } catch (err) {
    console.error(
      "frame capture error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
    // VideoStream is a ReadableStream: cancelling tears down the underlying
    // frame source, so a 10s sampling loop doesn't leak one per tick. On the
    // timeout path this is also what releases the read that never resolved.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Push the latest boxes to the candidate's browser over the room data channel.
 *
 * Lossy on purpose: this is a live overlay, so a dropped packet should be
 * replaced by the next one a second later rather than queued and delivered late.
 * Best-effort like everything else here — a publish failure must never disturb
 * sampling or the call.
 */
async function publishOverlay(ctx: JobContext, packet: OverlayPacket): Promise<void> {
  try {
    await ctx.room.localParticipant?.publishData(
      new TextEncoder().encode(JSON.stringify(packet)),
      { reliable: false, topic: VISION_OVERLAY_TOPIC },
    );
  } catch (err) {
    console.error(
      "vision overlay publish failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * One flagged frame, encoded for upload. The bytes are handed off and dropped.
 *
 * Carries the COUNTS, not a named finding: what a set of counts means is the
 * app's rule layer's vocabulary, and it derives the label on receipt. That keeps
 * a single definition of each condition rather than one here and one there that
 * must be kept in step by hand.
 */
export interface VisionSnapshot {
  /** ISO timestamp of the frame — how the app matches it to an incident. */
  at: string;
  person_count: number;
  phone_count: number;
  jpeg: Buffer;
}

export interface VisionProctor {
  /** Every usable reading so far, oldest first. */
  observations: () => VisionObservation[];
  /** Stop sampling. Safe to call more than once. */
  stop: () => void;
}

/**
 * Start sampling the candidate's camera for the life of the interview.
 *
 * Resolves the video track lazily: the candidate may enable their camera after
 * joining, or republish it mid-call, so this listens for track subscriptions
 * rather than requiring one up front. While no camera is published nothing is
 * sampled — absence of video is already covered by the browser's `camera_off`
 * signal, and inventing observations here would double-count it.
 *
 * `onSample` fires after each usable reading so the caller can report
 * incrementally; a crashed worker then loses at most one sample.
 */
export function startVisionProctoring(
  ctx: JobContext,
  onSample: (observations: VisionObservation[]) => void,
  onSnapshot?: (snapshot: VisionSnapshot) => void,
): VisionProctor {
  const observations: VisionObservation[] = [];
  let videoTrack: RemoteTrack | null = null;
  let stopped = false;
  let busy = false;
  let lastRecordedMs = 0;
  const lastSnapshotMs = new Map<string, number>();

  // Start the inference thread while the candidate is still being greeted, so
  // the first sample isn't also paying the model-load cost.
  preloadDetector();

  const adopt = (track: RemoteTrack, how: string) => {
    if (track.kind !== TrackKind.KIND_VIDEO || videoTrack === track) return;
    videoTrack = track;
    console.info(`vision: watching the candidate's camera (${how})`);
  };

  const onSubscribed = (track: RemoteTrack) => adopt(track, "subscribed");
  const onUnsubscribed = (track: RemoteTrack) => {
    if (track === videoTrack) videoTrack = null;
  };

  ctx.room.on(RoomEvent.TrackSubscribed, onSubscribed);
  ctx.room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);

  // The camera may ALREADY be subscribed by the time we get here, and
  // `TrackSubscribed` does not re-fire for it. This runs after `ctx.connect()`
  // and after the instructions fetch — an HTTP round trip to the app — while
  // the candidate publishes their camera within about a second of joining. Lose
  // that race and `videoTrack` stays null for the whole interview: the sampler
  // ticks, returns immediately every time, logs nothing, and the report comes
  // back `vision_sampled: false` with no indication that anything went wrong.
  //
  // The candidate's own browser has always reconciled the mirror image of this
  // for the agent's audio track; the worker simply never did it for the camera.
  for (const participant of ctx.room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) adopt(publication.track, "already subscribed");
    }
  }

  // A camera that never arrives is the one failure this module cannot report as
  // evidence, so it says so in the log instead of leaving a silent gap.
  const noCameraWarning = setTimeout(() => {
    if (!videoTrack) {
      console.warn(
        `vision: no camera track ${Math.round(NO_CAMERA_WARN_MS / 1000)}s in — ` +
          `no camera evidence will be reported for this interview`,
      );
    }
  }, NO_CAMERA_WARN_MS);
  noCameraWarning.unref?.();

  const tickMs = OVERLAY_ENABLED
    ? Math.min(OVERLAY_INTERVAL_MS, SAMPLE_INTERVAL_MS)
    : SAMPLE_INTERVAL_MS;

  const timer = setInterval(async () => {
    // `busy` serialises the ticks: a slow capture or inference must skip the
    // next sample rather than overlap it, or two runs end up competing for the
    // same track and stamping observations out of order.
    if (stopped || busy || !videoTrack) return;
    busy = true;
    try {
      const frame = await captureFrame(videoTrack);
      if (!frame) return;

      // Stamped at CAPTURE, not after inference: the reading describes the
      // moment the shutter closed, and the rule layer measures durations
      // between these timestamps.
      const capturedMs = Date.now();
      const at = new Date(capturedMs).toISOString();

      const reading = await detectFrame(frame.data, frame.width, frame.height);

      if (OVERLAY_ENABLED) {
        // An unreadable frame publishes an empty list rather than nothing, so a
        // stale box doesn't sit frozen on screen after detection stops working.
        await publishOverlay(ctx, { at, boxes: reading?.boxes ?? [] });
      }

      if (!reading) return;

      // The overlay may run far faster than the report needs. Record on the
      // report's own cadence so the stored evidence — and every threshold
      // expressed against it — is unchanged by how smooth the overlay looks.
      if (capturedMs - lastRecordedMs < SAMPLE_INTERVAL_MS) return;
      lastRecordedMs = capturedMs;

      observations.push({
        at,
        person_count: reading.person_count,
        confidence: reading.confidence,
        phone_count: reading.phone_count,
      });
      onSample([...observations]);

      // Evidence still, only for a frame that actually carries a finding, and
      // only if this condition hasn't been photographed recently. Deliberately
      // hung off the RECORDED observation rather than the overlay tick: it must
      // depict a frame that is in the report, and it inherits the confidence
      // filtering that goes with it.
      if (SNAPSHOTS_ENABLED && onSnapshot) {
        const bucket = snapshotBucket(reading);
        if (bucket && capturedMs - (lastSnapshotMs.get(bucket) ?? 0) >= SNAPSHOT_MIN_INTERVAL_MS) {
          lastSnapshotMs.set(bucket, capturedMs);
          const jpeg = await encodeSnapshot(
            frame.data,
            frame.width,
            frame.height,
            reading.boxes,
          );
          if (jpeg) {
            onSnapshot({
              at,
              person_count: reading.person_count,
              phone_count: reading.phone_count,
              jpeg,
            });
          }
        }
      }
    } catch (err) {
      // Never let a sampling failure surface into the interview.
      console.error(
        "vision sampling error:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      busy = false;
    }
  }, tickMs);

  return {
    observations: () => [...observations],
    stop: () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(noCameraWarning);
      ctx.room.off(RoomEvent.TrackSubscribed, onSubscribed);
      ctx.room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    },
  };
}
