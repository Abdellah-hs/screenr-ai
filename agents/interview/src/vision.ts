/**
 * Vision proctoring for the AI video interview (Phase C2).
 *
 * The candidate publishes a camera track, but the interviewer itself is
 * speech-to-speech and never looks at it. This module is the only thing that
 * does: it samples one frame every ~10s, runs a local object detector over it
 * (`detector.ts`), and hands the readings back for reporting to the app.
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
import { encodeSnapshot, snapshotCondition, type SnapshotCondition } from "./snapshot.js";

/** One sampled frame's reading. Mirrors `VisionObservation` in the app. */
export interface VisionObservation {
  at: string;
  person_count: number;
  confidence: number;
  phone_count: number;
}

/**
 * How often an observation is RECORDED for the proctoring report. The rule
 * thresholds are expressed in milliseconds, not sample counts, so they stay
 * correct at any cadence; intervals above ~15s start losing the shorter
 * incidents entirely, and on a 10-minute call there is little room to widen it
 * before ~60 samples becomes too few to say anything.
 *
 * Deliberately NOT the same knob as the overlay cadence below. The app bounds a
 * report at 500 observations, so driving this at overlay speed would blow the
 * schema on a long call — and would quietly change what every stored report
 * means.
 */
const SAMPLE_INTERVAL_MS = Number(process.env.VISION_SAMPLE_INTERVAL_MS) || 10_000;

/** Set `VISION_OVERLAY=0` to stop publishing boxes to the candidate's browser. */
const OVERLAY_ENABLED = (process.env.VISION_OVERLAY ?? "1") !== "0";

/**
 * How often frames are scored while the overlay is on.
 *
 * The overlay is why this exists: at the report's 10s cadence a drawn box is up
 * to ten seconds stale, so it sits over where the candidate *used to be* and
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
 * photographs of a candidate. One still every 30s is enough to show a recruiter
 * that the condition persisted, and bounds a pathological interview to a couple
 * of dozen small images.
 */
const SNAPSHOT_MIN_INTERVAL_MS =
  Number(process.env.VISION_SNAPSHOT_INTERVAL_MS) || 30_000;

/** A single frame lifted off the live track, in RGBA. */
interface RawFrame {
  data: Buffer;
  width: number;
  height: number;
}

/** Grab one frame off the track and hand back raw pixels. */
async function captureFrame(track: RemoteTrack): Promise<RawFrame | null> {
  const stream = new VideoStream(track);
  const reader = stream.getReader();
  try {
    const { value, done } = await reader.read();
    if (done || !value) return null;

    // The wire format varies by codec/browser (I420 in practice); converting to
    // RGBA here means the detector only ever deals with one layout.
    const rgba = value.frame.convert(VideoBufferType.RGBA);
    return {
      data: Buffer.from(rgba.data),
      width: rgba.width,
      height: rgba.height,
    };
  } catch (err) {
    console.error(
      "frame capture error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    // VideoStream is a ReadableStream: cancelling tears down the underlying
    // frame source, so a 10s sampling loop doesn't leak one per tick.
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

/** One flagged frame, encoded for upload. The bytes are handed off and dropped. */
export interface VisionSnapshot {
  /** ISO timestamp of the frame — how the app matches it to an incident. */
  at: string;
  condition: SnapshotCondition;
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
  const lastSnapshotMs = new Map<SnapshotCondition, number>();

  // Warm the model while the candidate is still being greeted, so the first
  // sample isn't also paying the load cost.
  void preloadDetector();

  const onSubscribed = (track: RemoteTrack) => {
    if (track.kind === TrackKind.KIND_VIDEO) videoTrack = track;
  };
  const onUnsubscribed = (track: RemoteTrack) => {
    if (track === videoTrack) videoTrack = null;
  };

  ctx.room.on(RoomEvent.TrackSubscribed, onSubscribed);
  ctx.room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);

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
        const condition = snapshotCondition(reading);
        const since = condition ? capturedMs - (lastSnapshotMs.get(condition) ?? 0) : 0;
        if (condition && since >= SNAPSHOT_MIN_INTERVAL_MS) {
          lastSnapshotMs.set(condition, capturedMs);
          const jpeg = await encodeSnapshot(
            frame.data,
            frame.width,
            frame.height,
            reading.boxes,
          );
          if (jpeg) onSnapshot({ at, condition, jpeg });
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
      ctx.room.off(RoomEvent.TrackSubscribed, onSubscribed);
      ctx.room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    },
  };
}
