import { describe, expect, it } from "vitest";
import { encodeSnapshot, snapshotCondition } from "./snapshot.js";
import type { OverlayBox } from "./postprocess.js";

/** A solid-colour RGBA frame — enough for the encoder, no fixture file needed. */
function frame(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 90;
    buf[i + 1] = 120;
    buf[i + 2] = 160;
    buf[i + 3] = 255;
  }
  return buf;
}

function box(overrides: Partial<OverlayBox> = {}): OverlayBox {
  return { label: "person", x: 0.2, y: 0.2, w: 0.4, h: 0.5, score: 0.9, ...overrides };
}

describe("snapshotCondition", () => {
  it("files a frame with a second person under multiple_people", () => {
    expect(snapshotCondition({ person_count: 2, phone_count: 0 })).toBe("multiple_people");
  });

  it("files an empty frame under person_absent", () => {
    expect(snapshotCondition({ person_count: 0, phone_count: 0 })).toBe("person_absent");
  });

  it("files a phone under phone_visible", () => {
    expect(snapshotCondition({ person_count: 1, phone_count: 1 })).toBe("phone_visible");
  });

  // A snapshot is one image, so it gets one filing. The extra person is the
  // more serious claim; the app still derives both incidents from the counts.
  it("prefers the more serious condition when a frame carries two", () => {
    expect(snapshotCondition({ person_count: 2, phone_count: 1 })).toBe("multiple_people");
  });

  it("captures nothing for an ordinary frame", () => {
    expect(snapshotCondition({ person_count: 1, phone_count: 0 })).toBeNull();
  });
});

describe("encodeSnapshot", () => {
  it("encodes a JPEG", async () => {
    const jpeg = await encodeSnapshot(frame(1280, 720), 1280, 720, [box()]);

    expect(jpeg).not.toBeNull();
    // JPEG magic number — proves a real image came out, not just a buffer.
    expect(jpeg!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("downscales to keep stored evidence small", async () => {
    const jpeg = await encodeSnapshot(frame(1920, 1080), 1920, 1080, [box()]);

    // A handful of these must stay a rounding error next to the 30MB
    // recordings they replaced.
    expect(jpeg!.byteLength).toBeLessThan(200_000);
  });

  it("does not enlarge a frame that is already small", async () => {
    const small = await encodeSnapshot(frame(320, 240), 320, 240, []);

    expect(small).not.toBeNull();
    expect(small!.byteLength).toBeLessThan(50_000);
  });

  it("encodes with no boxes at all", async () => {
    const jpeg = await encodeSnapshot(frame(640, 360), 640, 360, []);

    expect(jpeg).not.toBeNull();
  });

  // Annotation is what makes a stored image evidence rather than just a photo of
  // a candidate: it shows the reader exactly what was claimed.
  it("produces a different image once boxes are drawn on it", async () => {
    const bare = await encodeSnapshot(frame(640, 360), 640, 360, []);
    const annotated = await encodeSnapshot(frame(640, 360), 640, 360, [
      box(),
      box({ label: "phone", x: 0.7, y: 0.6, w: 0.1, h: 0.15, score: 0.6 }),
    ]);

    expect(annotated!.equals(bare!)).toBe(false);
  });

  it("returns null instead of throwing on a malformed frame", async () => {
    // Buffer far too small for the stated dimensions.
    const jpeg = await encodeSnapshot(Buffer.alloc(16), 1280, 720, []);

    expect(jpeg).toBeNull();
  });
});
