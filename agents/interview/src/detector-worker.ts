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
import sharp from "sharp";
import type * as OrtTypes from "onnxruntime-node";
import {
  INPUT_SIZE,
  countKept,
  decodeYoloxOutput,
  frameUsability,
  letterboxRatio,
  luminanceStats,
  nms,
  observationConfidence,
  selectSignals,
  toOverlayBoxes,
  type OverlayBox,
} from "./postprocess.js";

const require = createRequire(import.meta.url);

/** YOLOX pads the letterbox remainder with this constant, not with black. */
const PAD_VALUE = 114;

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

/**
 * Build YOLOX's input tensor from a raw RGBA frame.
 *
 * Two conventions here are YOLOX-specific and easy to get wrong, both taken from
 * its own `demo/ONNXRuntime` reference: the model wants **BGR** channel order,
 * and it wants raw **0–255** values with no mean/std normalisation. Feeding it
 * normalised RGB produces boxes that look reasonable and are quietly wrong.
 *
 * The luminance stats are measured on the RESIZED CONTENT ONLY, before padding.
 * A 16:9 webcam frame letterboxed into a square is ~44% flat grey padding, which
 * would drag the mean toward 114 and crush the standard deviation — a well-lit
 * interview would then score as an unusable frame.
 */
async function preprocess(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<{ tensorData: Float32Array; usability: number; ratio: number } | null> {
  const ratio = letterboxRatio(width, height);
  if (ratio <= 0) return null;

  const contentWidth = Math.max(1, Math.min(INPUT_SIZE, Math.round(width * ratio)));
  const contentHeight = Math.max(1, Math.min(INPUT_SIZE, Math.round(height * ratio)));

  const content = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize(contentWidth, contentHeight, { fit: "fill", kernel: "linear" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const { mean, stdDev } = luminanceStats(content);

  const plane = INPUT_SIZE * INPUT_SIZE;
  const tensorData = new Float32Array(3 * plane).fill(PAD_VALUE);

  for (let y = 0; y < contentHeight; y++) {
    const srcRow = y * contentWidth * 3;
    const dstRow = y * INPUT_SIZE;
    for (let x = 0; x < contentWidth; x++) {
      const src = srcRow + x * 3;
      const dst = dstRow + x;
      tensorData[dst] = content[src + 2]; // B
      tensorData[plane + dst] = content[src + 1]; // G
      tensorData[2 * plane + dst] = content[src]; // R
    }
  }

  // The ratio travels with the tensor it scaled: decoding the boxes back to
  // frame coordinates must use the exact value the pixels were resized by.
  return { tensorData, usability: frameUsability(mean, stdDev), ratio };
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
  const thresholds = { personMinScore: minScore, phoneMinScore: minScore };

  // Select once; count from that exact array. The overlay and the report can
  // therefore never disagree about what the frame contained.
  const kept = selectSignals(nms(decodeYoloxOutput(raw, { ratio })), frame, thresholds);
  const signals = countKept(kept);

  return {
    person_count: signals.personCount,
    phone_count: signals.phoneCount,
    confidence: observationConfidence(prepared.usability, signals),
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
