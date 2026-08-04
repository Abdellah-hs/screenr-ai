import { describe, expect, it } from "vitest";
import {
  INPUT_SIZE,
  PERSON_CLASS_ID,
  countSignals,
  decodeYoloxOutput,
  frameUsability,
  letterboxRatio,
  luminanceStats,
  nms,
  observationConfidence,
  type Detection,
} from "./postprocess.js";

const NUM_ATTRS = 85;
const TOTAL_ANCHORS = 52 * 52 + 26 * 26 + 13 * 13; // 3549 at 416px

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

  it("reports the weakest counted person, not the strongest", () => {
    const signals = countSignals(
      [
        detection(PERSON_CLASS_ID, 0.95, [0, 0, 400, 700]),
        detection(PERSON_CLASS_ID, 0.51, [600, 0, 1000, 700]),
      ],
      frame,
    );

    expect(signals.personCount).toBe(2);
    expect(signals.weakestPersonScore).toBeCloseTo(0.51, 6);
  });

  it("reports full confidence in an empty frame (there is no box to doubt)", () => {
    const signals = countSignals([], frame);

    expect(signals).toEqual({ personCount: 0, phoneCount: 0, weakestPersonScore: 1 });
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
  it("trusts an empty frame as much as the frame quality allows", () => {
    const confidence = observationConfidence(0.9, {
      personCount: 0,
      weakestPersonScore: 1,
    });

    expect(confidence).toBeCloseTo(0.9, 6);
  });

  it("caps confidence at the weakest box the count depends on", () => {
    const confidence = observationConfidence(1, {
      personCount: 2,
      weakestPersonScore: 0.45,
    });

    expect(confidence).toBeCloseTo(0.45, 6);
  });

  it("is limited by frame quality even when the detection was strong", () => {
    const confidence = observationConfidence(0.3, {
      personCount: 1,
      weakestPersonScore: 0.99,
    });

    expect(confidence).toBeCloseTo(0.3, 6);
  });
});
