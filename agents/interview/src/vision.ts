/**
 * Vision proctoring for the AI video interview (Phase C2).
 *
 * The candidate publishes a camera track, but the interviewer itself is
 * speech-to-speech and never looks at it. This module is the only thing that
 * does: it samples one frame every ~10s, asks a vision model how many people are
 * in shot, and hands the readings back for reporting to the app.
 *
 * Two boundaries are deliberate and load-bearing:
 *
 *  1. It is kept OUT of the interviewer's conversation. Feeding frames into the
 *     Realtime session would make the interviewer react to what it sees ("is
 *     someone there with you?"), which tips off the candidate, derails the
 *     interview, and turns a monitoring signal into an accusation delivered live.
 *     The interviewer stays deaf to this entirely.
 *  2. It reports COUNTS AND CONFIDENCE, never verdicts. Nothing here decides
 *     that a candidate cheated, and no threshold lives in this file — the app's
 *     rule layer (`summarizeProctoring`) owns severity, so the judgement is
 *     versioned, unit-tested, and identical for every candidate.
 *
 * Failure is always silent and total: if the model is unreachable, the track
 * never arrives, or sampling throws, the interview continues untouched and the
 * report simply carries fewer samples. Proctoring must never cost a candidate
 * their interview.
 */
import { llm } from "@livekit/agents";
import { RoomEvent, TrackKind, VideoStream, type RemoteTrack } from "@livekit/rtc-node";
import type { JobContext } from "@livekit/agents";

/** One sampled frame's reading. Mirrors `VisionObservation` in the app. */
export interface VisionObservation {
  at: string;
  face_count: number;
  confidence: number;
}

/**
 * How often to sample. Every frame is a billed vision call, so this is the cost
 * dial: measured at ~2,980 prompt tokens per frame on gpt-4o-mini (its image
 * token multiplier is far higher than gpt-4o's, even at `detail: "low"`), a
 * 10-minute interview at 10s ≈ 60 frames ≈ 180k tokens ≈ $0.03. Raise the
 * interval to cut that; the rule thresholds are expressed in milliseconds, not
 * sample counts, so they stay correct at any cadence — though intervals above
 * ~15s start losing the shorter incidents entirely, and on a call this short
 * there is little room to widen it before the evidence thins out.
 */
const SAMPLE_INTERVAL_MS = Number(process.env.VISION_SAMPLE_INTERVAL_MS) || 10_000;

/**
 * Frames are downscaled hard before they leave the worker. A face count needs
 * far less resolution than a readable screen, and this keeps both the token cost
 * and the amount of the candidate's video crossing the network to a minimum.
 */
const INFERENCE_WIDTH = 512;

/** Vision-capable and cheap; the task is counting people, not reading text. */
const VISION_MODEL = process.env.VISION_MODEL || "gpt-4o-mini";

/** A stalled vision call must never delay the next sample or leak a handle. */
const VISION_REQUEST_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT =
  "You analyse a single webcam frame from a video job interview for proctoring. " +
  "Report only what is visibly verifiable. Count DISTINCT REAL HUMAN FACES that " +
  "are physically present in the room. Do NOT count faces on screens, posters, " +
  "photographs, reflections, or artwork. If the image is too dark, blurred, or " +
  "ambiguous to judge, say so with low confidence rather than guessing. " +
  'Respond with JSON only: {"face_count": <integer>, "confidence": <0-1>}. ' +
  "Confidence is how certain you are of the count, where below 0.6 means the " +
  "frame is not usable as evidence.";

interface VisionReading {
  face_count: number;
  confidence: number;
}

/** Parse and hard-bound the model's reply; anything odd becomes "unusable". */
function parseReading(raw: string): VisionReading | null {
  try {
    const json = JSON.parse(raw) as Partial<VisionReading>;
    if (typeof json.face_count !== "number" || typeof json.confidence !== "number") {
      return null;
    }
    if (!Number.isFinite(json.face_count) || !Number.isFinite(json.confidence)) return null;
    return {
      face_count: Math.max(0, Math.min(20, Math.round(json.face_count))),
      confidence: Math.max(0, Math.min(1, json.confidence)),
    };
  } catch {
    return null;
  }
}

/** Ask the vision model to read one frame. Returns null when unusable. */
async function analyzeFrame(dataUrl: string): Promise<VisionReading | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        max_tokens: 60,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "How many real people are in this frame?" },
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error(`vision analysis failed (${res.status})`);
      return null;
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    return content ? parseReading(content) : null;
  } catch (err) {
    console.error(
      "vision analysis error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Grab a single frame off the track and encode it for the vision model. */
async function captureFrame(track: RemoteTrack): Promise<string | null> {
  const stream = new VideoStream(track);
  const reader = stream.getReader();
  try {
    const { value, done } = await reader.read();
    if (done || !value) return null;

    const serialized = await llm.serializeImage(
      llm.createImageContent({
        image: value.frame,
        inferenceDetail: "low",
        inferenceWidth: INFERENCE_WIDTH,
      }),
    );
    if (!serialized.base64Data) return null;
    return `data:${serialized.mimeType ?? "image/jpeg"};base64,${serialized.base64Data}`;
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
): VisionProctor {
  const observations: VisionObservation[] = [];
  let videoTrack: RemoteTrack | null = null;
  let stopped = false;

  const onSubscribed = (track: RemoteTrack) => {
    if (track.kind === TrackKind.KIND_VIDEO) videoTrack = track;
  };
  const onUnsubscribed = (track: RemoteTrack) => {
    if (track === videoTrack) videoTrack = null;
  };

  ctx.room.on(RoomEvent.TrackSubscribed, onSubscribed);
  ctx.room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);

  const timer = setInterval(async () => {
    if (stopped || !videoTrack) return;
    try {
      const dataUrl = await captureFrame(videoTrack);
      if (!dataUrl) return;

      const reading = await analyzeFrame(dataUrl);
      if (!reading) return;

      observations.push({
        at: new Date().toISOString(),
        face_count: reading.face_count,
        confidence: reading.confidence,
      });
      onSample([...observations]);
    } catch (err) {
      // Never let a sampling failure surface into the interview.
      console.error(
        "vision sampling error:",
        err instanceof Error ? err.message : err,
      );
    }
  }, SAMPLE_INTERVAL_MS);

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
