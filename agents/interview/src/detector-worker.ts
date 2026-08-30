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
  decodeFloor,
  diagnosticDecodeFloor,
  effectiveFloors,
  INPUT_SIZE,
  countKept,
  decodeYoloxOutput,
  describeCandidates,
  nms,
  observationConfidence,
  selectSignals,
  toOverlayBoxes,
  type Detection,
  type SignalThresholds,
  type OverlayBox,
} from "./postprocess.js";
import { preprocess } from "./preprocess.js";

/**
 * `VISION_DEBUG_SCORES=1` logs what the model actually thought of every person
 * and phone in each frame, with the floors beside it.
 *
 * For answering one question: when a signal does not register, was it scored
 * below its floor, too small a share of the frame, or never produced at all?
 * Those need opposite fixes, and lowering a threshold for the wrong one adds
 * false findings against real candidates without catching anything.
 *
 * Off by default and never on in normal operation: it logs a line per sampled
 * frame, which at the overlay cadence is one a second.
 */
const DEBUG_SCORES = process.env.VISION_DEBUG_SCORES === "1";

/**
 * `thresholds` is the same object handed to `selectSignals`, so the floors
 * printed are the ones actually applied — including the override and its
 * one-way clamp. Printing the compiled-in defaults would name a floor the
 * pipeline is not using, in exactly the configuration someone sets this flag
 * to investigate.
 */
function logCandidates(
  detections: Detection[],
  frame: { width: number; height: number },
  thresholds: SignalThresholds,
): void {
  const candidates = describeCandidates(detections, frame);
  // A frame with nothing in it is the common case and would drown the log.
  if (candidates.length === 0) return;

  const floors = effectiveFloors(thresholds);
  const hasPhone = candidates.some((c) => c.label === "phone");
  const seen = candidates
    .slice(0, 6)
    .map((c) => `${c.label} score=${c.score.toFixed(3)} area=${(c.areaRatio * 100).toFixed(2)}%`)
    .join(" | ");

  console.log(
    `vision.debug: ${seen}` +
      ` || floors: person>=${floors.person} extra-person>=${floors.additionalPerson}` +
      ` phone>=${floors.phone} phone-area>=${(floors.phoneArea * 100).toFixed(2)}%` +
      (hasPhone ? "" : " || NO PHONE CANDIDATE AT ALL"),
  );
}

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
  const thresholds: SignalThresholds = {
    personMinScore: minScore,
    additionalPersonMinScore: minScore,
    phoneMinScore: minScore,
  };

  const decodeMinScore = decodeFloor(minScore);

  // The diagnostic decodes the SAME tensor a second time, at a floor under every
  // real one, so the log can show a signal that was scored and REJECTED rather
  // than only one that was never produced. A second pass rather than a lowered
  // floor plus a compensating filter: that shape made the production reading
  // depend on `minScore` having no effect other than a score cut, which nothing
  // pins. This way the production decode below is the same line it was before
  // the flag existed, and the diagnostic floor cannot reach it.
  // A decode is ~1ms against a ~50ms inference, and only when debugging.
  if (DEBUG_SCORES) {
    logCandidates(
      decodeYoloxOutput(raw, { ratio, minScore: diagnosticDecodeFloor(minScore) }),
      frame,
      thresholds,
    );
  }

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
