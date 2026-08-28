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
 * Minimum detection score to count THE FIRST person — the candidate.
 *
 * Deliberately permissive, and the asymmetry with the floor below is the whole
 * point. Failing to detect the person who is sitting there does not produce "no
 * finding": it produces `person_absent`, an accusation, against someone who
 * never left. Side lighting, a turned head or a half-cropped torso routinely
 * score in the 0.4s. So the candidate is easy to find, and the real
 * false-positive guard for them is the area floor below.
 */
const PERSON_MIN_SCORE = 0.35;

/**
 * Minimum detection score to count a SECOND (or third…) person.
 *
 * The opposite bias, for the opposite reason: an extra person in the room is a
 * claim of misconduct, and a wrong one is the expensive failure — with no
 * recording, nobody can go and check it. So every person after the first has to
 * be seen clearly, and a marginal box is simply not counted rather than being
 * reported and argued about later.
 *
 * It is `VISION_MIN_CONFIDENCE` (0.6) by construction: that is the bar the rule
 * layer already applies to a frame before it will believe anything in it, so
 * counting an extra person below it would report evidence the rules would
 * refuse to act on anyway.
 */
const ADDITIONAL_PERSON_MIN_SCORE = 0.6;

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
 * Pre-NMS score floor. Below every class threshold on purpose — filtering here
 * only bounds how much work NMS does; the real decisions happen after it.
 *
 * Exported because a caller lowering a class floor for tuning has to lower this
 * one with it. It sits in front of every other threshold, so an override above
 * it is honoured and one below it silently does nothing — the anchor was
 * already gone.
 */
export const DECODE_MIN_SCORE = 0.2;

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
  // A short tensor is a broken model export, not a frame we can partly read, so
  // the guard bounds the whole walk rather than one row of one pyramid level —
  // `break`ing out of the innermost loop alone left the outer ones spinning
  // over anchors that had already been ruled out.
  const anchorCount = Math.floor(raw.length / NUM_ATTRS);
  let anchorOffset = 0;

  for (const stride of STRIDES) {
    const gridSize = Math.floor(inputSize / stride);

    for (let cell = 0; cell < gridSize * gridSize; cell++) {
      const anchor = anchorOffset + cell;
      if (anchor >= anchorCount) return detections;

      const gy = Math.floor(cell / gridSize);
      const gx = cell % gridSize;
      const base = anchor * NUM_ATTRS;

      // Class probabilities are ≤ 1, so objectness bounds the final score —
      // bailing here skips the 80-wide class scan for the vast majority of
      // the 3,549 anchors.
      const objectness = raw[base + 4];
      if (objectness < minScore) continue;

      // Only the anchor's BEST class survives, which is a deliberate
      // narrowing of YOLOX's reference `multiclass_nms` — that keeps every
      // (box, class) pair above the floor. It costs recall in one case: a
      // phone whose top class at its anchor is something else is dropped
      // outright. Kept because this pipeline is biased to miss rather than
      // invent, and a second class per anchor is a second chance to raise an
      // incident nobody can check against footage.
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
}

/** What a kept box means to the app. COCO classes collapse into these two. */
export type SignalLabel = "person" | "phone";

/**
 * Every person/phone candidate the model produced, with the two numbers that
 * decide whether it counts. Diagnostic only — nothing in the pipeline reads it.
 *
 * It exists because "my phone was not detected" has three different causes that
 * look identical from outside: the model scored it below the floor, the box was
 * too small a share of the frame, or the model never saw it at all. Lowering a
 * threshold fixes only the first, and lowering one for the other two adds false
 * accusations without catching anything. This is what tells them apart.
 */
export function describeCandidates(
  detections: Detection[],
  frame: { width: number; height: number },
): { label: SignalLabel; score: number; areaRatio: number }[] {
  const frameArea = Math.max(0, frame.width) * Math.max(0, frame.height);
  if (frameArea === 0) return [];

  return detections
    .filter((d) => d.classId === PERSON_CLASS_ID || PHONE_CLASS_IDS.has(d.classId))
    .map((d) => {
      const x1 = Math.max(0, Math.min(d.box[0], frame.width));
      const y1 = Math.max(0, Math.min(d.box[1], frame.height));
      const x2 = Math.max(0, Math.min(d.box[2], frame.width));
      const y2 = Math.max(0, Math.min(d.box[3], frame.height));
      return {
        label: (d.classId === PERSON_CLASS_ID ? "person" : "phone") as SignalLabel,
        score: d.score,
        areaRatio: (Math.max(0, x2 - x1) * Math.max(0, y2 - y1)) / frameArea,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** The floors `describeCandidates` output should be read against. */
export const DETECTION_FLOORS = {
  person: PERSON_MIN_SCORE,
  additionalPerson: ADDITIONAL_PERSON_MIN_SCORE,
  phone: PHONE_MIN_SCORE,
  personArea: PERSON_MIN_AREA_RATIO,
  phoneArea: PHONE_MIN_AREA_RATIO,
} as const;

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
 *
 * People are graded on a SLIDING floor, best box first: the strongest person is
 * the candidate and is found easily, every person after them must be seen
 * clearly. The two failures are not symmetrical and must not share a threshold
 * — missing the candidate manufactures `person_absent` against somebody sitting
 * right there, while inventing an extra person accuses them of something.
 *
 * A person who fails the stricter floor is simply NOT COUNTED, and the frame is
 * still reported. That distinction is the whole repair: the marginal box used
 * to be counted and then poison the sample's confidence, which made the rule
 * layer discard the frame whole — losing the candidate's own presence and any
 * phone in the same shot along with the doubtful second person.
 */
export function selectSignals(
  detections: Detection[],
  frame: { width: number; height: number },
  opts: {
    personMinScore?: number;
    additionalPersonMinScore?: number;
    phoneMinScore?: number;
  } = {},
): CountedDetection[] {
  const personMinScore = opts.personMinScore ?? PERSON_MIN_SCORE;
  const phoneMinScore = opts.phoneMinScore ?? PHONE_MIN_SCORE;
  // The extra-person floor can only ever be RAISED. The knob behind it is a
  // single env var meant for tuning a real camera, and the honest reading of
  // "detect more" is "find the candidate more easily" — not "accuse more
  // easily". A config change must not be able to quietly lower the bar on a
  // finding nobody can check against footage. Also never below the floor for
  // the first person, or a high override would leave a second person easier to
  // count than the candidate, which is incoherent in the dangerous direction.
  const additionalPersonMinScore = Math.max(
    ADDITIONAL_PERSON_MIN_SCORE,
    personMinScore,
    opts.additionalPersonMinScore ?? 0,
  );
  const frameArea = Math.max(0, frame.width) * Math.max(0, frame.height);
  if (frameArea === 0) return [];

  const kept: CountedDetection[] = [];
  // Strongest first, so "the first person" means the best-evidenced one rather
  // than whichever anchor the decoder happened to reach first. `nms` already
  // sorts this way; sorting here means `selectSignals` does not depend on it.
  const ordered = [...detections].sort((a, b) => b.score - a.score);
  let peopleCounted = 0;

  for (const det of ordered) {
    const isPerson = det.classId === PERSON_CLASS_ID;
    const isPhone = PHONE_CLASS_IDS.has(det.classId);
    if (!isPerson && !isPhone) continue;

    const x1 = Math.max(0, Math.min(det.box[0], frame.width));
    const y1 = Math.max(0, Math.min(det.box[1], frame.height));
    const x2 = Math.max(0, Math.min(det.box[2], frame.width));
    const y2 = Math.max(0, Math.min(det.box[3], frame.height));
    const areaRatio = (Math.max(0, x2 - x1) * Math.max(0, y2 - y1)) / frameArea;

    const minScore = isPerson
      ? peopleCounted === 0
        ? personMinScore
        : additionalPersonMinScore
      : phoneMinScore;
    const minArea = isPerson ? PERSON_MIN_AREA_RATIO : PHONE_MIN_AREA_RATIO;
    if (det.score < minScore || areaRatio < minArea) continue;

    if (isPerson) peopleCounted++;
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

  for (const det of kept) {
    if (det.label === "person") personCount++;
    else phoneCount++;
  }

  return { personCount, phoneCount };
}

/** Select and count in one call, for callers that don't need the boxes. */
export function countSignals(
  detections: Detection[],
  frame: { width: number; height: number },
  opts: {
    personMinScore?: number;
    additionalPersonMinScore?: number;
    phoneMinScore?: number;
  } = {},
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
 * The confidence carried by one reported sample: HOW WELL THE FRAME COULD BE
 * SEEN, and nothing else.
 *
 * It used to also be capped by the weakest counted person's score, on the
 * reasoning that a marginal detection should not be reported as a certainty.
 * That reasoning was right and the mechanism was wrong, because the rule layer
 * does not read confidence as a discount — it reads it as a gate, and discards
 * the whole sample below `VISION_MIN_CONFIDENCE` (0.6). So a candidate detected
 * at 0.5 in a well-lit room did not produce weak evidence of presence; they
 * produced NO evidence, and the frame vanished along with any phone in it.
 *
 * That inverted the bias this module exists to hold. An empty frame inherited
 * only the (high) frame quality and was kept, while an occupied one inherited
 * the (low) box score and was deleted — so the pipeline systematically kept
 * confident absences and threw away marginal presences. Two deleted samples sit
 * inside `VISION_MAX_SAMPLE_GAP_MS`, so they did not even break the run: a
 * candidate visible for twenty seconds of a thirty-second window was reported
 * absent for all thirty.
 *
 * Detection strength now decides WHAT IS COUNTED, in `selectSignals`, where a
 * doubtful box costs only itself. This decides whether the frame is worth
 * believing at all — the judgement a detector cannot make for itself, since it
 * answers an unlit room with the same silence as an empty one.
 */
export function observationConfidence(usability: number): number {
  return Math.max(0, Math.min(1, usability));
}
