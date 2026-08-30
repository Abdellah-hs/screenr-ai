import { describe, expect, it } from "vitest";
import {
  DECODE_MIN_SCORE,
  INPUT_SIZE,
  PERSON_CLASS_ID,
  describeCandidates,
  DIAGNOSTIC_DECODE_FLOOR,
  decodeFloor,
  diagnosticDecodeFloor,
  effectiveFloors,
  countKept,
  countSignals,
  decodeYoloxOutput,
  frameUsability,
  letterboxRatio,
  luminanceStats,
  nms,
  observationConfidence,
  selectSignals,
  toOverlayBoxes,
  type Detection,
} from "./postprocess.js";

const NUM_ATTRS = 85;
const TOTAL_ANCHORS = 52 * 52 + 26 * 26 + 13 * 13; // 3549 at 416px

/**
 * The rule layer's `VISION_MIN_CONFIDENCE`, restated here because the two
 * packages deploy separately: a sample the worker reports below this is thrown
 * away wholesale, so anything this file reports has to clear it.
 */
const VISION_MIN_CONFIDENCE = 0.6;

/** COCO ids used below, named so the assertions read as intent. */
const CELL_PHONE = 67;
const REMOTE = 65;
const LAPTOP = 63;
const BOOK = 73;

/**
 * Build a raw YOLOX output tensor with a single active anchor, so the decode can
 * be checked against arithmetic done by hand rather than against itself.
 */
function rawWithAnchor(args: {
  anchorIndex: number;
  offsets: [number, number, number, number];
  objectness: number;
  classId: number;
  classScore: number;
}): Float32Array {
  const raw = new Float32Array(TOTAL_ANCHORS * NUM_ATTRS);
  const base = args.anchorIndex * NUM_ATTRS;
  raw[base] = args.offsets[0];
  raw[base + 1] = args.offsets[1];
  raw[base + 2] = args.offsets[2];
  raw[base + 3] = args.offsets[3];
  raw[base + 4] = args.objectness;
  raw[base + 5 + args.classId] = args.classScore;
  return raw;
}

function detection(
  classId: number,
  score: number,
  box: [number, number, number, number],
): Detection {
  return { classId, score, box };
}

describe("letterboxRatio", () => {
  it("shrinks by the tighter of the two axes for a landscape frame", () => {
    const ratio = letterboxRatio(1280, 720, INPUT_SIZE);

    expect(ratio).toBeCloseTo(416 / 1280, 6);
  });

  it("shrinks by height for a portrait frame", () => {
    const ratio = letterboxRatio(720, 1280, INPUT_SIZE);

    expect(ratio).toBeCloseTo(416 / 1280, 6);
  });

  it("maps a square frame exactly onto the input with no padding", () => {
    const ratio = letterboxRatio(832, 832, INPUT_SIZE);

    expect(ratio).toBe(0.5);
  });

  it("returns 0 for a degenerate frame rather than dividing by zero", () => {
    expect(letterboxRatio(0, 720)).toBe(0);
    expect(letterboxRatio(1280, 0)).toBe(0);
  });
});

describe("decodeYoloxOutput", () => {
  it("reconstructs a box from its grid cell, stride and log-scale size", () => {
    // Stride-8 level, cell (gx=10, gy=5): centre (0.5+10)*8 = 84, (0.25+5)*8 = 42;
    // size exp(ln 4)*8 = 32 wide, exp(0)*8 = 8 tall.
    const raw = rawWithAnchor({
      anchorIndex: 5 * 52 + 10,
      offsets: [0.5, 0.25, Math.log(4), 0],
      objectness: 0.9,
      classId: PERSON_CLASS_ID,
      classScore: 0.8,
    });

    const [det, ...rest] = decodeYoloxOutput(raw, { ratio: 1 });

    expect(rest).toHaveLength(0);
    expect(det.classId).toBe(PERSON_CLASS_ID);
    expect(det.score).toBeCloseTo(0.72, 6);
    expect(det.box.map((v) => Math.round(v))).toEqual([68, 38, 100, 46]);
  });

  it("applies the right stride to each pyramid level", () => {
    // First anchor of the stride-16 level sits immediately after the 52x52 grid.
    const raw = rawWithAnchor({
      anchorIndex: 52 * 52,
      offsets: [0, 0, 0, 0],
      objectness: 1,
      classId: PERSON_CLASS_ID,
      classScore: 1,
    });

    const [det] = decodeYoloxOutput(raw, { ratio: 1 });

    // Centre (0+0)*16 = 0, size exp(0)*16 = 16 → box spans -8..8.
    expect(det.box.map((v) => Math.round(v))).toEqual([-8, -8, 8, 8]);
  });

  it("scales boxes back to source-image coordinates by the letterbox ratio", () => {
    const raw = rawWithAnchor({
      anchorIndex: 5 * 52 + 10,
      offsets: [0.5, 0.25, Math.log(4), 0],
      objectness: 0.9,
      classId: PERSON_CLASS_ID,
      classScore: 0.8,
    });

    const [det] = decodeYoloxOutput(raw, { ratio: 0.5 });

    // Same box as the first test, but the source frame was twice as large.
    expect(det.box.map((v) => Math.round(v))).toEqual([136, 76, 200, 92]);
  });

  it("keeps the highest-scoring class for an anchor", () => {
    const raw = rawWithAnchor({
      anchorIndex: 0,
      offsets: [0, 0, 0, 0],
      objectness: 1,
      classId: PERSON_CLASS_ID,
      classScore: 0.4,
    });
    raw[5 + CELL_PHONE] = 0.9;

    const [det] = decodeYoloxOutput(raw, { ratio: 1 });

    expect(det.classId).toBe(CELL_PHONE);
    expect(det.score).toBeCloseTo(0.9, 6);
  });

  it("drops anchors below the score floor", () => {
    const raw = rawWithAnchor({
      anchorIndex: 0,
      offsets: [0, 0, 0, 0],
      objectness: 0.5,
      classId: PERSON_CLASS_ID,
      classScore: 0.2, // 0.5 * 0.2 = 0.10, under the default 0.2 floor
    });

    expect(decodeYoloxOutput(raw, { ratio: 1 })).toEqual([]);
  });

  it("stops at the end of a short tensor instead of reading past it", () => {
    // Half a tensor: a broken export, not a frame we can partly believe.
    const full = rawWithAnchor({
      anchorIndex: 0,
      offsets: [0.5, 0.5, 0, 0],
      objectness: 0.9,
      classId: PERSON_CLASS_ID,
      classScore: 0.9,
    });
    const truncated = full.slice(0, 10 * NUM_ATTRS);

    const detections = decodeYoloxOutput(truncated, { ratio: 1 });

    expect(detections).toHaveLength(1);
    expect(detections.every((d) => Number.isFinite(d.box[0]))).toBe(true);
  });

  it("honours a score floor below the default, which the decode gate used to swallow", () => {
    const raw = rawWithAnchor({
      anchorIndex: 0,
      offsets: [0.5, 0.5, 0, 0],
      objectness: 0.3,
      classId: PERSON_CLASS_ID,
      classScore: 0.3, // 0.09 combined — under the 0.2 default
    });

    expect(decodeYoloxOutput(raw, { ratio: 1 })).toHaveLength(0);
    expect(
      decodeYoloxOutput(raw, { ratio: 1, minScore: DECODE_MIN_SCORE / 4 }),
    ).toHaveLength(1);
  });

  it("returns nothing for a degenerate ratio instead of infinite coordinates", () => {
    const raw = rawWithAnchor({
      anchorIndex: 0,
      offsets: [0, 0, 0, 0],
      objectness: 1,
      classId: PERSON_CLASS_ID,
      classScore: 1,
    });

    expect(decodeYoloxOutput(raw, { ratio: 0 })).toEqual([]);
  });
});

describe("nms", () => {
  it("keeps the best of two heavily overlapping boxes of the same class", () => {
    const kept = nms([
      detection(PERSON_CLASS_ID, 0.7, [10, 10, 110, 210]),
      detection(PERSON_CLASS_ID, 0.9, [12, 12, 112, 212]),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].score).toBeCloseTo(0.9, 6);
  });

  it("keeps two people standing apart", () => {
    const kept = nms([
      detection(PERSON_CLASS_ID, 0.9, [0, 0, 100, 200]),
      detection(PERSON_CLASS_ID, 0.8, [300, 0, 400, 200]),
    ]);

    expect(kept).toHaveLength(2);
  });

  // The phone-in-front-of-a-person case: the boxes overlap almost entirely, and
  // suppressing across classes would delete one of the two findings we care about.
  it("never suppresses across classes", () => {
    const kept = nms([
      detection(PERSON_CLASS_ID, 0.9, [0, 0, 200, 400]),
      detection(CELL_PHONE, 0.6, [40, 100, 90, 190]),
    ]);

    expect(kept.map((d) => d.classId).sort()).toEqual([PERSON_CLASS_ID, CELL_PHONE]);
  });
});

describe("countSignals", () => {
  const frame = { width: 1280, height: 720 }; // 921,600 px²

  it("counts a person filling a normal share of the frame", () => {
    const signals = countSignals(
      [detection(PERSON_CLASS_ID, 0.9, [400, 100, 800, 700])],
      frame,
    );

    expect(signals.personCount).toBe(1);
  });

  // The poster / background-monitor false positive: a person too small to be in
  // the room with the candidate must not be counted.
  it("ignores a person too small to be physically present", () => {
    const signals = countSignals(
      [detection(PERSON_CLASS_ID, 0.95, [10, 10, 60, 110])], // 5,000 px² ≈ 0.5%
      frame,
    );

    expect(signals.personCount).toBe(0);
  });

  it("ignores a person below the score floor", () => {
    const signals = countSignals(
      [detection(PERSON_CLASS_ID, 0.2, [400, 100, 800, 700])],
      frame,
    );

    expect(signals.personCount).toBe(0);
  });

  it("counts a clearly-seen second person", () => {
    const signals = countSignals(
      [
        detection(PERSON_CLASS_ID, 0.95, [0, 0, 400, 700]),
        detection(PERSON_CLASS_ID, 0.72, [600, 0, 1000, 700]),
      ],
      frame,
    );

    expect(signals.personCount).toBe(2);
  });

  it("reports nothing for an empty frame", () => {
    const signals = countSignals([], frame);

    expect(signals).toEqual({ personCount: 0, phoneCount: 0 });
  });

  it("counts a phone in shot", () => {
    const signals = countSignals(
      [detection(CELL_PHONE, 0.7, [500, 300, 560, 420])],
      frame,
    );

    expect(signals.phoneCount).toBe(1);
  });

  // COCO detectors routinely label a held phone as a remote — same shape, same
  // pose in the hand. Excluding it would miss much of what we're looking for.
  it("treats a `remote` as a phone", () => {
    const signals = countSignals([detection(REMOTE, 0.7, [500, 300, 560, 420])], frame);

    expect(signals.phoneCount).toBe(1);
  });

  // A second screen is the normal case on a desktop-only interview; firing on it
  // would raise an incident for nearly every candidate.
  it("ignores laptops and books entirely", () => {
    const signals = countSignals(
      [
        detection(LAPTOP, 0.99, [0, 300, 500, 700]),
        detection(BOOK, 0.99, [900, 400, 1100, 600]),
      ],
      frame,
    );

    expect(signals.phoneCount).toBe(0);
  });

  it("ignores a phone below the stricter phone score floor", () => {
    const signals = countSignals(
      [detection(CELL_PHONE, 0.4, [500, 300, 560, 420])],
      frame,
    );

    expect(signals.phoneCount).toBe(0);
  });

  // A box that runs off the edge is judged on the part actually visible, so an
  // extrapolated box can't buy its way past the area floor.
  it("clips boxes to the frame before measuring their area", () => {
    const signals = countSignals(
      [detection(PERSON_CLASS_ID, 0.9, [-4000, -4000, 30, 30])],
      frame,
    );

    expect(signals.personCount).toBe(0);
  });
});

/**
 * The two person floors, and why they are not the same number.
 *
 * Missing the candidate manufactures `person_absent` against somebody sitting
 * right there. Inventing a second person accuses them of something nobody can
 * check, because the interview is not recorded. Opposite failures, opposite
 * biases, and they used to share one threshold plus a confidence cap that
 * deleted the whole frame when the weaker box was doubtful.
 */
describe("selectSignals: the sliding person floor", () => {
  const frame = { width: 1280, height: 720 };
  const person = (score: number, box: Detection["box"]): Detection => ({
    classId: PERSON_CLASS_ID,
    score,
    box,
  });

  it("counts the candidate on a weak box, because missing them accuses them", () => {
    const kept = selectSignals([person(0.4, [200, 40, 900, 700])], frame);

    expect(countKept(kept)).toEqual({ personCount: 1, phoneCount: 0 });
  });

  it("does not count a doubtful second person", () => {
    const kept = selectSignals(
      [person(0.95, [0, 0, 400, 700]), person(0.45, [600, 0, 1000, 700])],
      frame,
    );

    expect(countKept(kept)).toEqual({ personCount: 1, phoneCount: 0 });
  });

  it("counts a second person who is clearly there", () => {
    const kept = selectSignals(
      [person(0.95, [0, 0, 400, 700]), person(0.7, [600, 0, 1000, 700])],
      frame,
    );

    expect(countKept(kept)).toEqual({ personCount: 2, phoneCount: 0 });
  });

  /**
   * The regression. A doubtful extra person used to poison the sample's
   * confidence, and the rule layer discards a low-confidence sample WHOLE — so
   * the phone sitting in the same shot disappeared along with the second person
   * nobody was sure about, and so did the candidate's own presence.
   */
  it("keeps the phone and the candidate when the second person is dropped", () => {
    const kept = selectSignals(
      [
        person(0.95, [0, 0, 400, 700]),
        person(0.45, [600, 0, 1000, 700]),
        { classId: CELL_PHONE, score: 0.8, box: [430, 300, 500, 430] },
      ],
      frame,
    );

    expect(countKept(kept)).toEqual({ personCount: 1, phoneCount: 1 });
  });

  it("grades people best-first regardless of the order they arrive in", () => {
    const weakFirst = selectSignals(
      [person(0.45, [600, 0, 1000, 700]), person(0.95, [0, 0, 400, 700])],
      frame,
    );

    expect(countKept(weakFirst)).toEqual({ personCount: 1, phoneCount: 0 });
    expect(weakFirst[0]?.score).toBeCloseTo(0.95, 6);
  });

  it("never lets an override make an extra person easier to invent", () => {
    // Tuning the candidate floor down must not drag the stricter floor with it:
    // "detect more" means "find the candidate more easily", never "accuse more
    // easily".
    const kept = selectSignals(
      [person(0.3, [0, 0, 400, 700]), person(0.3, [600, 0, 1000, 700])],
      frame,
      { personMinScore: 0.2, additionalPersonMinScore: 0.2 },
    );

    expect(countKept(kept).personCount).toBe(1);
  });

  it("keeps an extra person at least as hard to count as the candidate", () => {
    // A high override must not leave the second person the EASIER of the two.
    const kept = selectSignals(
      [person(0.9, [0, 0, 400, 700]), person(0.7, [600, 0, 1000, 700])],
      frame,
      { personMinScore: 0.85 },
    );

    expect(countKept(kept).personCount).toBe(1);
  });
});

describe("selectSignals / toOverlayBoxes", () => {
  const frame = { width: 1280, height: 720 };

  // The overlay must show exactly what the report counted — one set of
  // thresholds, so a candidate can never see a box for something that wasn't
  // recorded (or miss one that was).
  it("returns only the detections that pass the counting thresholds", () => {
    const kept = selectSignals(
      [
        detection(PERSON_CLASS_ID, 0.9, [400, 100, 800, 700]), // counted
        detection(PERSON_CLASS_ID, 0.95, [10, 10, 60, 110]), // too small
        detection(CELL_PHONE, 0.4, [500, 300, 560, 420]), // below phone floor
        detection(LAPTOP, 0.99, [0, 300, 500, 700]), // not a tracked class
      ],
      frame,
    );

    expect(kept).toHaveLength(1);
    expect(kept[0].label).toBe("person");
  });

  it("labels a remote as a phone, matching the count", () => {
    const kept = selectSignals([detection(REMOTE, 0.7, [500, 300, 560, 420])], frame);

    expect(kept[0].label).toBe("phone");
  });

  it("normalises boxes to frame fractions", () => {
    const kept = selectSignals(
      [detection(PERSON_CLASS_ID, 0.9, [320, 180, 960, 540])],
      frame,
    );

    const [overlay] = toOverlayBoxes(kept, frame);

    expect(overlay).toMatchObject({ label: "person", x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it("clips a box that runs off the edge into the 0–1 range", () => {
    const kept = selectSignals(
      [detection(PERSON_CLASS_ID, 0.9, [-500, -500, 900, 700])],
      frame,
    );

    const [overlay] = toOverlayBoxes(kept, frame);

    expect(overlay.x).toBe(0);
    expect(overlay.y).toBe(0);
    expect(overlay.x + overlay.w).toBeLessThanOrEqual(1);
    expect(overlay.y + overlay.h).toBeLessThanOrEqual(1);
  });

  it("returns nothing for a degenerate frame", () => {
    expect(toOverlayBoxes([], { width: 0, height: 0 })).toEqual([]);
  });
});

describe("luminanceStats", () => {
  it("measures a uniform mid-grey as flat", () => {
    const rgb = Buffer.alloc(300, 128);

    const { mean, stdDev } = luminanceStats(rgb, 1);

    expect(mean).toBeCloseTo(128, 4);
    expect(stdDev).toBeCloseTo(0, 4);
  });

  it("measures spread across a black-and-white checker", () => {
    const rgb = Buffer.alloc(600);
    for (let px = 0; px < 200; px++) {
      const v = px % 2 === 0 ? 0 : 255;
      rgb[px * 3] = v;
      rgb[px * 3 + 1] = v;
      rgb[px * 3 + 2] = v;
    }

    const { mean, stdDev } = luminanceStats(rgb, 1);

    expect(mean).toBeCloseTo(127.5, 0);
    expect(stdDev).toBeGreaterThan(100);
  });
});

describe("frameUsability", () => {
  // The single most dangerous failure mode: an unlit room looks exactly like an
  // abandoned one to a detector, so it must score below the rule layer's 0.6 floor.
  it("scores an unlit frame as unusable", () => {
    expect(frameUsability(6, 3)).toBeLessThan(0.6);
  });

  it("scores a blown-out frame as unusable", () => {
    expect(frameUsability(253, 40)).toBeLessThan(0.6);
  });

  it("scores a flat frame with no detail as unusable", () => {
    expect(frameUsability(120, 2)).toBeLessThan(0.6);
  });

  it("scores a normally-lit frame as fully usable", () => {
    expect(frameUsability(120, 55)).toBe(1);
  });
});

describe("observationConfidence", () => {
  it("reports how well the frame could be seen", () => {
    expect(observationConfidence(0.9)).toBeCloseTo(0.9, 6);
  });

  it("clamps a nonsensical usability into range", () => {
    expect(observationConfidence(1.4)).toBe(1);
    expect(observationConfidence(-0.2)).toBe(0);
  });

  /**
   * The regression this whole area exists for. Detection strength decides what
   * is COUNTED; it must never decide whether the frame is believed, because the
   * rule layer reads confidence as a gate and discards the sample below 0.6 —
   * taking the candidate's own presence with it.
   */
  it("does not let a marginal detection sink a well-lit frame", () => {
    const kept = selectSignals(
      [{ classId: PERSON_CLASS_ID, score: 0.42, box: [200, 40, 900, 700] }],
      { width: 1280, height: 720 },
    );

    expect(countKept(kept).personCount).toBe(1);
    expect(observationConfidence(0.95)).toBeGreaterThanOrEqual(
      VISION_MIN_CONFIDENCE,
    );
  });
});

/**
 * The diagnostic behind "my phone was not detected". Three causes look
 * identical from outside — scored too low, too small, or never produced — and
 * they need opposite fixes, so this has to report the raw numbers rather than
 * a verdict.
 */
describe("describeCandidates", () => {
  const frame = { width: 1000, height: 1000 };

  it("reports the score and frame share of every person and phone", () => {
    const result = describeCandidates(
      [
        detection(PERSON_CLASS_ID, 0.9, [0, 0, 500, 500]),
        detection(CELL_PHONE, 0.8, [0, 0, 100, 100]),
      ],
      frame,
    );

    expect(result).toEqual([
      { label: "person", score: 0.9, areaRatio: 0.25 },
      { label: "phone", score: 0.8, areaRatio: 0.01 },
    ]);
  });

  it("keeps a candidate that its floor would reject, which is the point", () => {
    // 0.31 is below PHONE_MIN_SCORE (0.45). If this were filtered, the log
    // could never distinguish "scored too low" from "never seen".
    const result = describeCandidates(
      [detection(CELL_PHONE, 0.31, [0, 0, 100, 100])],
      frame,
    );

    expect(result).toHaveLength(1);
    expect(result[0].score).toBeLessThan(effectiveFloors().phone);
  });

  it("counts a remote as a phone, like the counting path does", () => {
    const result = describeCandidates(
      [detection(REMOTE, 0.5, [0, 0, 100, 100])],
      frame,
    );

    expect(result[0].label).toBe("phone");
  });

  it("ignores classes the product does not report on", () => {
    // A laptop is deliberately not a finding, so it must not appear here either
    // and imply the detector saw something it will act on.
    expect(
      describeCandidates([detection(LAPTOP, 0.99, [0, 0, 100, 100])], frame),
    ).toEqual([]);
  });

  it("orders strongest first, so the log's first entry is the best evidence", () => {
    const result = describeCandidates(
      [
        detection(CELL_PHONE, 0.2, [0, 0, 100, 100]),
        detection(PERSON_CLASS_ID, 0.8, [0, 0, 100, 100]),
      ],
      frame,
    );

    expect(result.map((c) => c.score)).toEqual([0.8, 0.2]);
  });
});

/**
 * The floors the diagnostic prints and the counting path applies are one
 * derivation, so the log can never name a floor that is not in force. These pin
 * the clamp, which is the part an override can get wrong in the dangerous
 * direction.
 */
describe("effectiveFloors", () => {
  it("applies the override to the person and phone floors", () => {
    const floors = effectiveFloors({ personMinScore: 0.25, phoneMinScore: 0.25 });

    expect(floors.person).toBe(0.25);
    expect(floors.phone).toBe(0.25);
  });

  it("refuses to lower the extra-person floor, however low the override", () => {
    // The asymmetry `selectSignals` exists to hold: "detect more" means find
    // the candidate more easily, never accuse more easily.
    const floors = effectiveFloors({
      personMinScore: 0.1,
      additionalPersonMinScore: 0.1,
    });

    expect(floors.additionalPerson).toBe(0.6);
  });

  it("raises the extra-person floor to match a stricter first-person floor", () => {
    const floors = effectiveFloors({ personMinScore: 0.8 });

    expect(floors.additionalPerson).toBe(0.8);
  });

  it("reports the compiled-in defaults when nothing is overridden", () => {
    expect(effectiveFloors()).toEqual({
      person: 0.35,
      additionalPerson: 0.6,
      phone: 0.45,
      personArea: 0.015,
      phoneArea: 0.003,
    });
  });
});

/**
 * The two decode floors, which used to live inline in the worker — the file
 * with no test of its own. The production one has already been a bug once (an
 * override below 0.2 silently did nothing, because this floor runs in front of
 * every class threshold), which is why it is pinned here.
 */
describe("decodeFloor", () => {
  it("passes undefined through, so no override means the decoder's own default", () => {
    expect(decodeFloor(undefined)).toBeUndefined();
  });

  it("lowers the decode floor to match an override below it", () => {
    // The bug this exists to prevent: at 0.2 the anchor was already gone, so
    // lowering only a class floor moved a filter nobody could see.
    expect(decodeFloor(0.05)).toBe(0.05);
  });

  it("keeps the decode floor where it is when the override is above it", () => {
    expect(decodeFloor(0.8)).toBe(DECODE_MIN_SCORE);
  });
});

describe("diagnosticDecodeFloor", () => {
  /**
   * The invariant the diagnostic depends on. Above the production floor it
   * would report "never produced at all" about a candidate the pipeline
   * actually decoded — the one reading that sends you tuning the wrong knob,
   * and exactly the confusion the flag exists to resolve.
   */
  it("never sits above the production floor, at any override", () => {
    for (const override of [undefined, 0.01, 0.05, 0.1, 0.2, 0.35, 0.6, 0.99]) {
      expect(diagnosticDecodeFloor(override)).toBeLessThanOrEqual(
        decodeFloor(override) ?? DECODE_MIN_SCORE,
      );
    }
  });

  it("follows an override below its own default down", () => {
    expect(diagnosticDecodeFloor(0.01)).toBe(0.01);
  });

  it("stays at its own floor when nothing is overridden", () => {
    expect(diagnosticDecodeFloor(undefined)).toBe(DIAGNOSTIC_DECODE_FLOOR);
  });
});
