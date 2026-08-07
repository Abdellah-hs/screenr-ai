import { describe, expect, it } from "vitest";
import {
  parseOverlayPacket,
  placeBoxes,
  type OverlayBox,
  type VideoGeometry,
} from "./overlay";

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function box(overrides: Partial<OverlayBox> = {}): OverlayBox {
  return { label: "person", x: 0.25, y: 0.1, w: 0.5, h: 0.8, score: 0.9, ...overrides };
}

/** A 16:9 frame in a 16:9 element — no crop, so the maths is pure scaling. */
const EXACT_FIT: VideoGeometry = {
  frameWidth: 1280,
  frameHeight: 720,
  elementWidth: 640,
  elementHeight: 360,
  mirrored: false,
};

describe("parseOverlayPacket", () => {
  it("parses a well-formed packet", () => {
    const packet = parseOverlayPacket(
      encode({ at: "2026-08-04T10:00:00.000Z", boxes: [box()] }),
    );

    expect(packet?.at).toBe("2026-08-04T10:00:00.000Z");
    expect(packet?.boxes).toHaveLength(1);
    expect(packet?.boxes[0].label).toBe("person");
  });

  it("accepts an empty box list — that is how boxes get cleared", () => {
    const packet = parseOverlayPacket(encode({ at: "2026-08-04T10:00:00.000Z", boxes: [] }));

    expect(packet?.boxes).toEqual([]);
  });

  // Untrusted bytes off a network channel: a drawing bug must never be able to
  // throw inside a live interview.
  it("returns null for malformed input instead of throwing", () => {
    expect(parseOverlayPacket(new TextEncoder().encode("not json"))).toBeNull();
    expect(parseOverlayPacket(encode({ boxes: [] }))).toBeNull(); // no `at`
    expect(parseOverlayPacket(encode({ at: "x" }))).toBeNull(); // no boxes
    expect(parseOverlayPacket(encode(null))).toBeNull();
  });

  it("drops individual boxes that are malformed, keeping the good ones", () => {
    const packet = parseOverlayPacket(
      encode({
        at: "2026-08-04T10:00:00.000Z",
        boxes: [
          box(),
          { label: "spaceship", x: 0, y: 0, w: 1, h: 1, score: 1 },
          { label: "phone", x: "wide", y: 0, w: 1, h: 1, score: 1 },
          { label: "person", x: Infinity, y: 0, w: 1, h: 1, score: 1 },
        ],
      }),
    );

    expect(packet?.boxes).toHaveLength(1);
  });

  it("defaults a missing score rather than dropping the box", () => {
    const packet = parseOverlayPacket(
      encode({
        at: "2026-08-04T10:00:00.000Z",
        boxes: [{ label: "phone", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      }),
    );

    expect(packet?.boxes[0]).toMatchObject({ label: "phone", score: 0 });
  });
});

describe("placeBoxes", () => {
  it("scales a box onto an element of the same aspect ratio", () => {
    const [placed] = placeBoxes([box()], EXACT_FIT);

    expect(placed.left).toBeCloseTo(160, 4); // 0.25 * 640
    expect(placed.top).toBeCloseTo(36, 4); // 0.1 * 360
    expect(placed.width).toBeCloseTo(320, 4); // 0.5 * 640
    expect(placed.height).toBeCloseTo(288, 4); // 0.8 * 360
  });

  // The self-view is mirrored, so a box on the candidate's left must be drawn on
  // the right. Getting this wrong puts every box confidently in the wrong place.
  it("flips x across the element when the preview is mirrored", () => {
    const [placed] = placeBoxes([box()], { ...EXACT_FIT, mirrored: true });

    // Unmirrored the box spans 160..480 of 640; mirrored it spans 160..480 from
    // the right edge, i.e. 640 - 480 = 160. Symmetric here by construction, so
    // use an asymmetric box to prove the flip actually happens.
    expect(placed.width).toBeCloseTo(320, 4);

    const [offCentre] = placeBoxes([box({ x: 0.0, w: 0.25 })], {
      ...EXACT_FIT,
      mirrored: true,
    });
    expect(offCentre.left).toBeCloseTo(480, 4); // 640 - 0 - 160
  });

  it("leaves x alone when the preview is not mirrored", () => {
    const [placed] = placeBoxes([box({ x: 0.0, w: 0.25 })], EXACT_FIT);

    expect(placed.left).toBeCloseTo(0, 4);
  });

  // object-fit: cover crops a 4:3 camera in a 16:9 box, so the visible region is
  // a window onto the frame — box positions must account for the lost slice.
  it("accounts for the object-fit: cover crop on a mismatched aspect ratio", () => {
    const geometry: VideoGeometry = {
      frameWidth: 640, // 4:3
      frameHeight: 480,
      elementWidth: 640, // 16:9
      elementHeight: 360,
      mirrored: false,
    };

    // scale = max(640/640, 360/480) = 1 → displayed 640x480, 120px of vertical
    // overflow, 60px cropped off the top.
    const [placed] = placeBoxes([box({ x: 0, y: 0.5, w: 1, h: 0.25 })], geometry);

    expect(placed.top).toBeCloseTo(180, 4); // 0.5 * 480 - 60
    expect(placed.height).toBeCloseTo(120, 4); // 0.25 * 480
    expect(placed.width).toBeCloseTo(640, 4);
  });

  it("returns nothing when the video has not reported its size yet", () => {
    expect(placeBoxes([box()], { ...EXACT_FIT, frameWidth: 0 })).toEqual([]);
    expect(placeBoxes([box()], { ...EXACT_FIT, elementHeight: 0 })).toEqual([]);
  });

  it("preserves the label and score for rendering", () => {
    const [placed] = placeBoxes([box({ label: "phone", score: 0.63 })], EXACT_FIT);

    expect(placed.label).toBe("phone");
    expect(placed.score).toBeCloseTo(0.63, 4);
  });
});
