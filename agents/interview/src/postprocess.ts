/**
 * Pure maths for the YOLOX proctoring detector.
 *
 * Everything here is arithmetic over plain arrays — no ONNX runtime, no sharp,
 * no I/O — so the part of the pipeline that is easiest to get subtly wrong (grid
 * decoding, NMS, the thresholds that decide what counts as a detection) is unit
 * testable without loading a 20MB model.
 *
 * The split with `detector.ts` mirrors the app's own layering: this module
 * decides *what the detector saw*, and never what it means. Severity, durations
 * and incidents all live in the app's rule layer (`summarizeProctoring`), which
 * is versioned and shared with the browser-signal half of the report. Nothing
 * here should ever grow a notion of misconduct.
 *
 * Bias: every threshold in this file is set to miss rather than invent. Wrongly
 * telling a recruiter that a real candidate had someone else in the room is far
 * more costly than staying quiet about a marginal frame — and since the
 * interview is not recorded, nobody can go back and check.
 */

/** YOLOX-tiny's fixed input resolution (the exported ONNX has static dims). */
export const INPUT_SIZE = 416;

/** Feature-map strides the YOLOX head predicts at, in output order. */
const STRIDES = [8, 16, 32] as const;

/** 4 box + 1 objectness + 80 COCO class scores. */
const NUM_CLASSES = 80;
const NUM_ATTRS = 5 + NUM_CLASSES;

/** COCO class ids. `person` is the only one we count as a human. */
export const PERSON_CLASS_ID = 0;

/**
 * What counts as "a phone in shot".
 *
 * `remote` (65) is in here deliberately: COCO-trained detectors routinely label a
 * held phone as a remote control — same size, same shape, same pose in the hand —
 * so excluding it would miss a large share of the exact thing we are looking for.
 *
 * `laptop` (63) and `tv` (62) are deliberately OUT. The interview is desktop-only,
 * so a screen in frame is the normal case, not evidence; including them would
 * raise an incident on nearly every candidate and teach recruiters to ignore the
 * report. `book` (73) is out for the same reason — it fires on the scratch paper
 * candidates are explicitly allowed to use.
 */
const PHONE_CLASS_IDS: ReadonlySet<number> = new Set([67, 65]);

/**
 * Minimum detection score to count a person. Low-ish because a person mid-frame
 * is the easiest thing this model does; the real false-positive guard is the area
 * floor below, and a weak score is separately folded into the sample's confidence
 * so the rule layer can discard it.
 */
const PERSON_MIN_SCORE = 0.35;

/**
 * Phones are small, often partly occluded by a hand, and easy to confuse with
 * other dark rectangles — so this is stricter than the person floor. Combined
 * with the rule layer's three-consecutive-sightings requirement, a single
 * confident-looking mistake still cannot produce an incident.
 */
const PHONE_MIN_SCORE = 0.45;

/**
 * A person must fill at least this fraction of the frame to be counted. This is
 * what stops the classic false positive: a face on a poster, a photo on the wall,
 * or a person on a background monitor. Someone actually in the room with the
 * candidate is close enough to the camera to clear it easily.
 */
const PERSON_MIN_AREA_RATIO = 0.015;

/** Same idea for phones, far smaller — a held phone is a small object by nature. */
const PHONE_MIN_AREA_RATIO = 0.003;

/** Boxes overlapping more than this are the same object; keep the best-scoring. */
const NMS_IOU_THRESHOLD = 0.45;

/**
 * Pre-NMS score floor. Below both class thresholds on purpose — filtering here
 * only bounds how much work NMS does; the real decisions happen after it.
 */
const DECODE_MIN_SCORE = 0.2;

/** One decoded box, in SOURCE-image pixel coordinates. */
export interface Detection {
  classId: number;
  score: number;
  /** [x1, y1, x2, y2] */
  box: [number, number, number, number];
}

/**
 * Letterbox scale factor: how much the source frame is shrunk to fit the model's
 * square input while preserving aspect ratio. YOLOX pads the remainder at the
 * bottom/right with a constant 114, so the content always starts at (0, 0) and
 * box coordinates map back to the source by a single divide — no offset.
 */
export function letterboxRatio(
  srcWidth: number,
  srcHeight: number,
  inputSize: number = INPUT_SIZE,
): number {
  if (srcWidth <= 0 || srcHeight <= 0) return 0;
  return Math.min(inputSize / srcHeight, inputSize / srcWidth);
}

/**
 * Turn YOLOX's raw `[1, n, 85]` output into boxes in source-image coordinates.
 *
 * The exported ONNX does NOT decode its own predictions: box centres are offsets
 * within their grid cell and box sizes are log-scale, both relative to the
 * stride. Reconstructing that is the step where an implementation silently
 * produces plausible-but-wrong boxes, which is exactly why it lives here with
 * tests rather than inline in the inference call.
 */
export function decodeYoloxOutput(
  raw: Float32Array | number[],
  opts: { ratio: number; inputSize?: number; minScore?: number },
): Detection[] {
  const inputSize = opts.inputSize ?? INPUT_SIZE;
  const minScore = opts.minScore ?? DECODE_MIN_SCORE;
  const { ratio } = opts;
  if (ratio <= 0) return [];

  const detections: Detection[] = [];
  let anchorOffset = 0;

  for (const stride of STRIDES) {
    const gridSize = Math.floor(inputSize / stride);

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const base = (anchorOffset + gy * gridSize + gx) * NUM_ATTRS;
        if (base + NUM_ATTRS > raw.length) break;

        // Class probabilities are ≤ 1, so objectness bounds the final score —
        // bailing here skips the 80-wide class scan for the vast majority of
        // the 3,549 anchors.
        const objectness = raw[base + 4];
        if (objectness < minScore) continue;

        let bestClass = -1;
        let bestClassScore = 0;
        for (let c = 0; c < NUM_CLASSES; c++) {
          const p = raw[base + 5 + c];
          if (p > bestClassScore) {
            bestClassScore = p;
            bestClass = c;
          }
        }
        if (bestClass < 0) continue;

        const score = objectness * bestClassScore;
        if (score < minScore) continue;

        const cx = (raw[base] + gx) * stride;
        const cy = (raw[base + 1] + gy) * stride;
        const w = Math.exp(raw[base + 2]) * stride;
        const h = Math.exp(raw[base + 3]) * stride;

        detections.push({
          classId: bestClass,
          score,
          box: [
            (cx - w / 2) / ratio,
            (cy - h / 2) / ratio,
            (cx + w / 2) / ratio,
            (cy + h / 2) / ratio,
          ],
        });
      }
    }

    anchorOffset += gridSize * gridSize;
  }

  return detections;
}

function iou(a: Detection["box"], b: Detection["box"]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);

  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (overlap === 0) return 0;

  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - overlap;
  return union <= 0 ? 0 : overlap / union;
}

/**
 * Greedy non-maximum suppression, PER CLASS. Per class matters here: a phone
 * held in front of a person overlaps that person's box almost entirely, and
 * suppressing across classes would delete one of the two findings we care most
 * about.
 */
export function nms(
  detections: Detection[],
  iouThreshold: number = NMS_IOU_THRESHOLD,
): Detection[] {
  const byClass = new Map<number, Detection[]>();
  for (const det of detections) {
    const bucket = byClass.get(det.classId);
    if (bucket) bucket.push(det);
    else byClass.set(det.classId, [det]);
  }

  const kept: Detection[] = [];
  for (const bucket of byClass.values()) {
    const candidates = [...bucket].sort((a, b) => b.score - a.score);
    const survivors: Detection[] = [];

    for (const candidate of candidates) {
      if (survivors.some((s) => iou(s.box, candidate.box) > iouThreshold)) continue;
      survivors.push(candidate);
    }
    kept.push(...survivors);
  }

  return kept.sort((a, b) => b.score - a.score);
}

export interface FrameSignals {
  personCount: number;
  phoneCount: number;
  /**
   * The lowest score among the people that were counted, or 1 when none were.
   * The weakest box is what the count hinges on, so it — not the best box — is
   * what the sample's confidence should inherit.
   */
  weakestPersonScore: number;
}

/** What a kept box means to the app. COCO classes collapse into these two. */
export type SignalLabel = "person" | "phone";

/** A detection that survived every threshold, clipped to the frame. */
export interface CountedDetection {
  label: SignalLabel;
  score: number;
  /** [x1, y1, x2, y2] in source pixels, clipped to the frame. */
  box: [number, number, number, number];
}

/**
 * The detections a frame actually counts — one source of truth for the
 * thresholds, so the counts sent to the app and the boxes drawn on screen can
 * never disagree about what was seen.
 *
 * Boxes are clipped to the frame before their area is measured, so a person
 * half out of shot is judged on the part actually visible rather than on an
 * extrapolated box that drifts off-screen.
 */
export function selectSignals(
  detections: Detection[],
  frame: { width: number; height: number },
  opts: { personMinScore?: number; phoneMinScore?: number } = {},
): CountedDetection[] {
  const personMinScore = opts.personMinScore ?? PERSON_MIN_SCORE;
  const phoneMinScore = opts.phoneMinScore ?? PHONE_MIN_SCORE;
  const frameArea = Math.max(0, frame.width) * Math.max(0, frame.height);
  if (frameArea === 0) return [];

  const kept: CountedDetection[] = [];

  for (const det of detections) {
    const isPerson = det.classId === PERSON_CLASS_ID;
    const isPhone = PHONE_CLASS_IDS.has(det.classId);
    if (!isPerson && !isPhone) continue;

    const x1 = Math.max(0, Math.min(det.box[0], frame.width));
    const y1 = Math.max(0, Math.min(det.box[1], frame.height));
    const x2 = Math.max(0, Math.min(det.box[2], frame.width));
    const y2 = Math.max(0, Math.min(det.box[3], frame.height));
    const areaRatio = (Math.max(0, x2 - x1) * Math.max(0, y2 - y1)) / frameArea;

    const minScore = isPerson ? personMinScore : phoneMinScore;
    const minArea = isPerson ? PERSON_MIN_AREA_RATIO : PHONE_MIN_AREA_RATIO;
    if (det.score < minScore || areaRatio < minArea) continue;

    kept.push({
      label: isPerson ? "person" : "phone",
      score: det.score,
      box: [x1, y1, x2, y2],
    });
  }

  return kept;
}

/**
 * Reduce already-selected boxes to the two counts the app understands.
 *
 * Split from `countSignals` so a caller that also needs the boxes (the overlay,
 * the evidence still) can select once and count from that exact array, rather
 * than selecting a second time and trusting two independent calls to agree.
 */
export function countKept(kept: CountedDetection[]): FrameSignals {
  let personCount = 0;
  let phoneCount = 0;
  let weakestPersonScore = 1;

  for (const det of kept) {
    if (det.label === "person") {
      personCount++;
      weakestPersonScore = Math.min(weakestPersonScore, det.score);
    } else {
      phoneCount++;
    }
  }

  return { personCount, phoneCount, weakestPersonScore };
}

/** Select and count in one call, for callers that don't need the boxes. */
export function countSignals(
  detections: Detection[],
  frame: { width: number; height: number },
  opts: { personMinScore?: number; phoneMinScore?: number } = {},
): FrameSignals {
  return countKept(selectSignals(detections, frame, opts));
}

/** A box as it travels to the browser: fractions of the frame, not pixels. */
export interface OverlayBox {
  label: SignalLabel;
  /** 0–1, rounded to 4dp to keep the data packet small. */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/**
 * Normalise counted boxes to frame fractions for the live overlay.
 *
 * Fractions rather than pixels because the browser draws them over a video
 * element whose displayed size has nothing to do with the frame the worker
 * scored — different resolution, different CSS box, and `object-fit: cover`
 * cropping in between. Only the receiver knows those, so it does that maths.
 */
export function toOverlayBoxes(
  counted: CountedDetection[],
  frame: { width: number; height: number },
): OverlayBox[] {
  if (frame.width <= 0 || frame.height <= 0) return [];
  const round = (v: number) => Math.round(v * 10_000) / 10_000;

  return counted.map((det) => ({
    label: det.label,
    x: round(det.box[0] / frame.width),
    y: round(det.box[1] / frame.height),
    w: round((det.box[2] - det.box[0]) / frame.width),
    h: round((det.box[3] - det.box[1]) / frame.height),
    score: Math.round(det.score * 100) / 100,
  }));
}

/** Rec. 601 luma, sampled — full-frame precision buys nothing at this scale. */
export function luminanceStats(
  rgb: Uint8Array | Buffer,
  sampleEveryNthPixel = 4,
): { mean: number; stdDev: number } {
  const step = Math.max(1, Math.floor(sampleEveryNthPixel)) * 3;
  let n = 0;
  let sum = 0;
  let sumSquares = 0;

  for (let i = 0; i + 2 < rgb.length; i += step) {
    const luma = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
    sum += luma;
    sumSquares += luma * luma;
    n++;
  }

  if (n === 0) return { mean: 0, stdDev: 0 };
  const mean = sum / n;
  const variance = Math.max(0, sumSquares / n - mean * mean);
  return { mean, stdDev: Math.sqrt(variance) };
}

function ramp(value: number, low: number, high: number): number {
  if (high <= low) return 1;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

/**
 * How usable a frame is as evidence, 0–1.
 *
 * A detector has no way to say "I couldn't see" — it just returns fewer boxes,
 * which reads downstream as "nobody was there". That is the single most
 * dangerous failure mode in this pipeline: an unlit room would look exactly like
 * an abandoned one. This is the stand-in for the judgement the model can't make.
 * It rides on the observation's `confidence`, and the rule layer discards any
 * sample below `VISION_MIN_CONFIDENCE` (0.6) instead of believing it.
 *
 * Both ends of the exposure range count: a frame lost to a backlit window is
 * just as unreadable as one lost to darkness, and a nearly flat frame (a lens
 * cap, a wall, a frozen encoder) has no detail to detect anything in.
 */
export function frameUsability(meanLuma: number, stdDev: number): number {
  const notTooDark = ramp(meanLuma, 20, 45);
  const notBlownOut = ramp(255 - meanLuma, 5, 20);
  const hasDetail = ramp(stdDev, 8, 20);
  return Math.min(notTooDark, notBlownOut, hasDetail);
}

/**
 * The confidence carried by one reported sample.
 *
 * With people in frame it is capped by the weakest box the count depends on, so
 * a marginal detection can't be reported as a certainty. With nobody in frame
 * there is no box to inherit from, and the honest reading is the frame quality
 * itself: a clear, well-lit, empty room IS a confident absence, while a black
 * frame is no evidence at all and gets dropped by the rule layer.
 */
export function observationConfidence(
  usability: number,
  signals: Pick<FrameSignals, "personCount" | "weakestPersonScore">,
): number {
  const clamped = Math.max(0, Math.min(1, usability));
  if (signals.personCount === 0) return clamped;
  return Math.min(clamped, Math.max(0, Math.min(1, signals.weakestPersonScore)));
}
