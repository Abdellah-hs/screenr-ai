/**
 * The detector, running on its own thread.
 *
 * This file exists for one reason: `onnxruntime-node`'s `run()` is NOT
 * asynchronous. It wraps a synchronous native call in `setImmediate`
 * (`onnxruntime-node/dist/backend.js`), so the inference executes on whichever
 * thread calls it and blocks that thread's event loop for its full duration —
 * measured at ~58ms per 416×416 frame on a modern laptop core.
 *
 * On the main thread that is disqualifying. This worker also pumps a live
 * OpenAI Realtime WebSocket and LiveKit audio in 10–20ms frames, so a 58ms
 * contiguous stall drops three to five audio frames. At the overlay's ~1/s
 * cadence that is a stutter every second, for the length of the interview.
 *
 * So inference gets its own thread and the audio loop never waits on it. The
 * main side hands over pixels and gets back counts; nothing else crosses.
 *
 * Note the thread count: with the work isolated here, MORE intra-op threads is
 * strictly better — it shortens the run without touching the audio loop. The
 * opposite of the right call when this ran inline.
 */
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import type * as OrtTypes from "onnxruntime-node";
import {
  DECODE_MIN_SCORE,
  INPUT_SIZE,
  countKept,
  decodeYoloxOutput,
  nms,
  observationConfidence,
  selectSignals,
  toOverlayBoxes,
  type OverlayBox,
} from "./postprocess.js";
import { preprocess } from "./preprocess.js";

const require = createRequire(import.meta.url);

/** Request/response envelopes. `id` correlates replies; frames may overtake. */
export interface DetectRequest {
  id: number;
  rgba: Uint8Array;
  width: number;
  height: number;
  minScore?: number;
}

export interface DetectReading {
  person_count: number;
  phone_count: number;
  confidence: number;
  boxes: OverlayBox[];
}

export interface DetectResponse {
  id: number;
  reading: DetectReading | null;
}

interface WorkerConfig {
  modelPath: string;
  threads: number;
}

const config = workerData as WorkerConfig;

let session: OrtTypes.InferenceSession | null = null;
/** Resolved alongside the session, so scoring a frame costs no module lookup. */
let ort: typeof OrtTypes | null = null;

async function loadSession(): Promise<OrtTypes.InferenceSession | null> {
  if (session) return session;
  try {
    ort = require("onnxruntime-node") as typeof OrtTypes;
    session = await ort.InferenceSession.create(config.modelPath, {
      intraOpNumThreads: config.threads,
      graphOptimizationLevel: "all",
      executionMode: "sequential",
    });
    console.log(`vision: loaded detector from ${config.modelPath}`);
    return session;
  } catch (err) {
    console.error(
      `vision: detector unavailable (${config.modelPath}) — proctoring will report no camera evidence:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function detect(request: DetectRequest): Promise<DetectReading | null> {
  const active = await loadSession();
  if (!active || !ort) return null;

  const { rgba, width, height, minScore } = request;
  const prepared = await preprocess(rgba, width, height);
  if (!prepared) return null;

  const inputName = active.inputNames[0];
  const outputName = active.outputNames[0];

  const output = await active.run({
    [inputName]: new ort.Tensor("float32", prepared.tensorData, [
      1,
      3,
      INPUT_SIZE,
      INPUT_SIZE,
    ]),
  });
  const raw = output[outputName]?.data;
  if (!(raw instanceof Float32Array)) return null;

  const { ratio } = prepared;
  const frame = { width, height };
  const thresholds = {
    personMinScore: minScore,
    additionalPersonMinScore: minScore,
    phoneMinScore: minScore,
  };

  // The override has to reach the DECODE floor too. That floor runs in front of
  // every class threshold, so lowering a class floor without lowering it just
  // moved a filter nobody could see: the anchor was already gone, and the knob
  // silently did nothing below 0.2 — exactly the range you reach for when a
  // real camera is under-detecting.
  const decodeMinScore =
    minScore === undefined ? undefined : Math.min(minScore, DECODE_MIN_SCORE);

  // Select once; count from that exact array. The overlay and the report can
  // therefore never disagree about what the frame contained.
  const decoded = decodeYoloxOutput(raw, { ratio, minScore: decodeMinScore });
  const kept = selectSignals(nms(decoded), frame, thresholds);
  const signals = countKept(kept);

  return {
    person_count: signals.personCount,
    phone_count: signals.phoneCount,
    confidence: observationConfidence(prepared.usability),
    boxes: toOverlayBoxes(kept, frame),
  };
}

parentPort?.on("message", async (request: DetectRequest) => {
  let reading: DetectReading | null = null;
  try {
    reading = await detect(request);
  } catch (err) {
    console.error(
      "vision: detection failed:",
      err instanceof Error ? err.message : err,
    );
  }
  parentPort?.postMessage({ id: request.id, reading } satisfies DetectResponse);
});

// Warm the model at spawn so the first candidate frame doesn't pay for it.
void loadSession();
