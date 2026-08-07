/**
 * Local object detection for interview proctoring.
 *
 * Runs YOLOX-tiny (Apache-2.0) on a dedicated worker thread. Nothing about a
 * frame leaves this process: pixels are pulled off the live LiveKit track,
 * scored in memory, and dropped. Only counts are ever reported, and the
 * interview is not recorded, so a frame's lifetime is one round trip.
 *
 * That locality is the point. The previous implementation POSTed every sampled
 * frame to a hosted vision API — a per-frame bill, a network round trip inside a
 * live call, and the candidate's face crossing a third-party boundary sixty
 * times per interview. This does the same job on the CPU already paid for.
 *
 * The thread matters as much as the locality: `onnxruntime-node`'s `run()` is a
 * synchronous native call behind a Promise, so running it inline would block
 * this process's event loop — the same loop pumping the Realtime WebSocket and
 * LiveKit audio — for ~58ms every frame. See `detector-worker.ts`.
 *
 * Fails silent and total, like everything else in the proctoring path: no model
 * file, an unreadable frame, a worker that won't spawn — all return null, the
 * interview continues untouched, and the report simply carries fewer samples.
 * A missing proctoring sample costs a recruiter a little evidence; a thrown
 * error would cost a candidate their interview.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DetectReading, DetectResponse } from "./detector-worker.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Committed alongside the source so a deploy is one artifact with no fetch. */
const DEFAULT_MODEL_PATH = resolve(HERE, "../models/yolox_tiny.onnx");

/**
 * Intra-op threads for inference. Now that the run is off the audio loop, more
 * is simply faster (~58ms → ~31ms at 4) with nothing to trade against — the
 * opposite of the right call when this ran inline.
 */
const INFERENCE_THREADS = Number(process.env.VISION_INFERENCE_THREADS) || 2;

/** A stuck worker must not wedge the sampler; skip the frame instead. */
const DETECT_TIMEOUT_MS = 5_000;

export type { DetectReading as DetectorReading } from "./detector-worker.js";

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

interface Pending {
  resolve: (reading: DetectReading | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let spawnFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function settle(id: number, reading: DetectReading | null): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(reading);
}

/** Spawn the inference thread once, lazily. Null forever if it can't start. */
function ensureWorker(): Worker | null {
  if (worker || spawnFailed) return worker;

  try {
    // tsx compiles this file on the fly, so the worker entry is the .ts source;
    // the loader that started the parent handles the child the same way.
    worker = new Worker(new URL("./detector-worker.ts", import.meta.url), {
      workerData: { modelPath: modelPath(), threads: INFERENCE_THREADS },
    });

    worker.on("message", (response: DetectResponse) => {
      settle(response.id, response.reading);
    });
    worker.on("error", (err) => {
      console.error("vision: detector thread error:", err.message);
      for (const id of [...pending.keys()]) settle(id, null);
    });
    worker.on("exit", () => {
      worker = null;
      spawnFailed = true;
      for (const id of [...pending.keys()]) settle(id, null);
    });

    // Don't hold the process open on shutdown for a detector nobody is reading.
    worker.unref();
  } catch (err) {
    spawnFailed = true;
    worker = null;
    console.error(
      "vision: could not start the detector thread — proctoring will report no camera evidence:",
      err instanceof Error ? err.message : err,
    );
  }

  return worker;
}

/**
 * Score one frame. Returns null when the frame can't be read at all — which is
 * different from "nobody was there", and must stay different: a null is simply
 * not reported, while a zero person count with good confidence is real evidence
 * of an empty chair.
 *
 * The buffer is structured-cloned rather than transferred: the caller still
 * needs the pixels afterwards to encode an evidence still for a flagged frame,
 * and transferring would detach it. The clone costs ~0.8ms for a 720p frame,
 * against the ~58ms of blocked event loop this thread exists to avoid.
 */
export async function detectFrame(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<DetectReading | null> {
  const active = ensureWorker();
  if (!active) return null;

  const id = nextId++;

  return new Promise<DetectReading | null>((resolveReading) => {
    const timer = setTimeout(() => {
      console.error(`vision: detection timed out after ${DETECT_TIMEOUT_MS}ms`);
      settle(id, null);
    }, DETECT_TIMEOUT_MS);

    pending.set(id, { resolve: resolveReading, timer });

    try {
      active.postMessage({ id, rgba, width, height, minScore: scoreOverride() });
    } catch (err) {
      console.error(
        "vision: could not hand the frame to the detector:",
        err instanceof Error ? err.message : err,
      );
      settle(id, null);
    }
  });
}

/** Start the inference thread before the first candidate frame arrives. */
export function preloadDetector(): void {
  ensureWorker();
}
