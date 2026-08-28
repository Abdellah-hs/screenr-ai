import { describe, expect, it } from "vitest";
import { INPUT_SIZE, letterboxRatio } from "./postprocess.js";
import { PAD_VALUE, preprocess } from "./preprocess.js";

const PLANE = INPUT_SIZE * INPUT_SIZE;

/** A solid RGBA frame, so the resize can't blur the values under assertion. */
function solidRgba(width: number, height: number, r: number, g: number, b: number) {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

/** Read one pixel out of the CHW tensor: [B, G, R] as YOLOX wants it. */
function tensorPixel(t: Float32Array, x: number, y: number): [number, number, number] {
  const i = y * INPUT_SIZE + x;
  return [t[i], t[PLANE + i], t[2 * PLANE + i]];
}

describe("preprocess", () => {
  /**
   * The convention that is easiest to get backwards and hardest to notice:
   * YOLOX is trained on `cv2.imread` output, which is BGR, with no
   * normalisation. Feeding it normalised RGB produces boxes that look entirely
   * reasonable and are quietly wrong.
   */
  it("writes BGR, not RGB, and leaves the values at 0-255", async () => {
    const prepared = await preprocess(solidRgba(64, 64, 10, 20, 30), 64, 64);

    expect(prepared).not.toBeNull();
    expect(tensorPixel(prepared!.tensorData, 0, 0)).toEqual([30, 20, 10]);
    expect(tensorPixel(prepared!.tensorData, 200, 200)).toEqual([30, 20, 10]);
  });

  it("pads the letterbox remainder with 114 at the bottom, content at the origin", async () => {
    // 16:9 into a square: content fills the top 234 rows, the rest is padding.
    const prepared = await preprocess(solidRgba(32, 18, 10, 20, 30), 32, 18);
    const contentHeight = Math.round(18 * letterboxRatio(32, 18));

    expect(prepared).not.toBeNull();
    expect(tensorPixel(prepared!.tensorData, 0, 0)).toEqual([30, 20, 10]);
    expect(tensorPixel(prepared!.tensorData, 0, contentHeight - 1)).toEqual([30, 20, 10]);
    expect(tensorPixel(prepared!.tensorData, 0, contentHeight + 5)).toEqual([
      PAD_VALUE,
      PAD_VALUE,
      PAD_VALUE,
    ]);
    expect(tensorPixel(prepared!.tensorData, 0, INPUT_SIZE - 1)).toEqual([
      PAD_VALUE,
      PAD_VALUE,
      PAD_VALUE,
    ]);
  });

  it("hands back the exact ratio the pixels were shrunk by", async () => {
    const prepared = await preprocess(solidRgba(32, 18, 10, 20, 30), 32, 18);

    expect(prepared!.ratio).toBeCloseTo(letterboxRatio(32, 18), 10);
  });

  /**
   * The padding must not reach the exposure stats. A 16:9 frame is ~44% flat
   * grey once letterboxed, all of it at 114 — so measuring after padding would
   * drag a dark room up toward "well lit" and report a frame nobody could see
   * as usable evidence of an empty chair.
   */
  it("measures usability on the content only, so a dark room stays dark", async () => {
    // Half black, half 50: mean luma ~25 (dark), plenty of detail.
    const width = 32;
    const height = 18;
    const buf = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = x < width / 2 ? 0 : 50;
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
        buf[i + 3] = 255;
      }
    }

    const prepared = await preprocess(buf, width, height);

    // Were the 114-grey padding counted, this frame would score a confident 1.
    expect(prepared!.usability).toBeLessThan(0.6);
  });

  it("returns null for a degenerate frame rather than asking sharp to resize it", async () => {
    expect(await preprocess(new Uint8Array(0), 0, 0)).toBeNull();
  });
});
