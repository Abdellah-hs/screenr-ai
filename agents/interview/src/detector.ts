/**
 * Local object detection for interview proctoring.
 *
 * Runs YOLOX-tiny (Apache-2.0) in-process through onnxruntime-node. Nothing
 * about a frame leaves this worker: pixels are pulled off the live LiveKit
 * track, scored in memory, and dropped. Only counts are ever reported, and the
 * interview is not recorded, so a frame's lifetime is one function call.
 *
 * That locality is the point. The previous implementation POSTed every sampled
 * frame to a hosted vision API — a per-frame bill, a network round trip inside a
 * live call, and the candidate's face crossing a third-party boundary sixty
 * times per interview. This does the same job on the CPU already paid for.
 *
 * Fails silent and total, like everything else in the proctoring path: no model
 * file, an unreadable frame, a runtime that won't load — all return null, the
 * interview continues untouched, and the report simply carries fewer samples.
 * A missing proctoring sample costs a recruiter a little evidence; a thrown
 * error would cost a candidate their interview.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type * as OrtTypes from "onnxruntime-node";
import {
  INPUT_SIZE,
  countSignals,
  decodeYoloxOutput,
  frameUsability,
  letterboxRatio,
  luminanceStats,
  nms,
  observationConfidence,
} from "./postprocess.js";

// onnxruntime-node ships CommonJS with native bindings; `createRequire` loads it
// from this ESM module without the interop surprises of a default import.
const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));

/** Committed alongside the source so a deploy is one artifact with no fetch. */
const DEFAULT_MODEL_PATH = resolve(HERE, "../models/yolox_tiny.onnx");

/** YOLOX pads the letterbox remainder with this constant, not with black. */
const PAD_VALUE = 114;

/** What the app is told about one frame. Counts only — never a verdict. */
export interface DetectorReading {
  person_count: number;
  phone_count: number;
  confidence: number;
}

function modelPath(): string {
  return process.env.VISION_MODEL_PATH || DEFAULT_MODEL_PATH;
}

/**
 * Optional single override for both class score floors. Useful when tuning
 * against a real camera; the defaults in `postprocess.ts` are what ships.
 */
function scoreOverride(): number | undefined {
  const raw = Number(process.env.VISION_DETECTION_MIN_SCORE);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : undefined;
}

let sessionPromise: Promise<OrtTypes.InferenceSession | null> | null = null;

/**
 * Load the model once, on first use. Single-threaded on purpose: this worker is
 * also driving a live Realtime audio session, and letting ONNX spin up a thread
 * per core to save ~20ms on a frame we only take every 10 seconds would be a
 * poor trade against the conversation stuttering.
 */
function loadSession(): Promise<OrtTypes.InferenceSession | null> {
  sessionPromise ??= (async () => {
    const path = modelPath();
    try {
      const ort = require("onnxruntime-node") as typeof OrtTypes;
      const session = await ort.InferenceSession.create(path, {
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        graphOptimizationLevel: "all",
        executionMode: "sequential",
      });
      console.log(`vision: loaded detector from ${path}`);
      return session;
    } catch (err) {
      console.error(
        `vision: detector unavailable (${path}) — proctoring will report no camera evidence:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  })();
  return sessionPromise;
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
  rgba: Buffer,
  width: number,
  height: number,
): Promise<{ tensorData: Float32Array; usability: number } | null> {
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

  return { tensorData, usability: frameUsability(mean, stdDev) };
}

/**
 * Score one frame. Returns null when the frame can't be read at all — which is
 * different from "nobody was there", and must stay different: a null is simply
 * not reported, while a zero person count with good confidence is real evidence
 * of an empty chair.
 */
export async function detectFrame(
  rgba: Buffer,
  width: number,
  height: number,
): Promise<DetectorReading | null> {
  const session = await loadSession();
  if (!session) return null;

  try {
    const prepared = await preprocess(rgba, width, height);
    if (!prepared) return null;

    const ort = require("onnxruntime-node") as typeof OrtTypes;
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    const feeds: Record<string, OrtTypes.Tensor> = {
      [inputName]: new ort.Tensor("float32", prepared.tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    };
    const output = await session.run(feeds);
    const raw = output[outputName]?.data;
    if (!(raw instanceof Float32Array)) return null;

    const minScore = scoreOverride();
    const detections = nms(
      decodeYoloxOutput(raw, { ratio: letterboxRatio(width, height) }),
    );
    const signals = countSignals(
      detections,
      { width, height },
      { personMinScore: minScore, phoneMinScore: minScore },
    );

    return {
      person_count: signals.personCount,
      phone_count: signals.phoneCount,
      confidence: observationConfidence(prepared.usability, signals),
    };
  } catch (err) {
    console.error(
      "vision: detection failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Warm the model before the first candidate frame arrives. Best-effort. */
export async function preloadDetector(): Promise<boolean> {
  return (await loadSession()) !== null;
}
