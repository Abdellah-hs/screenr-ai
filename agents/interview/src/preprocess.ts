/**
 * Building YOLOX's input tensor from a raw RGBA camera frame.
 *
 * Split out of `detector-worker.ts` for one reason: that file opens a 20MB ONNX
 * session at import, so nothing in it could be unit tested — and this is the
 * half most able to be quietly wrong. Two conventions here are YOLOX-specific
 * and produce boxes that look completely reasonable when you get them backwards:
 * the model wants **BGR** channel order, and it wants raw **0-255** values with
 * no mean/std normalisation. Both are taken from YOLOX's own
 * `demo/ONNXRuntime` reference, where the image arrives from `cv2.imread`
 * (BGR) and `preproc` does nothing to it but resize and pad.
 *
 * Everything here is arithmetic plus one `sharp` resize; no model, no network,
 * no session.
 */
import sharp from "sharp";
import { INPUT_SIZE, frameUsability, letterboxRatio, luminanceStats } from "./postprocess.js";

/** YOLOX pads the letterbox remainder with this constant, not with black. */
export const PAD_VALUE = 114;

export interface PreparedFrame {
  /** CHW BGR float32, `3 * INPUT_SIZE * INPUT_SIZE`, values 0-255. */
  tensorData: Float32Array;
  /** 0-1: how usable the frame is as evidence, measured before padding. */
  usability: number;
  /** The exact factor the pixels were shrunk by — boxes divide back by it. */
  ratio: number;
}

/**
 * The luminance stats are measured on the RESIZED CONTENT ONLY, before padding.
 * A 16:9 webcam frame letterboxed into a square is ~44% flat grey padding, which
 * would drag the mean toward 114 and crush the standard deviation — a well-lit
 * interview would then score as an unusable frame and be discarded.
 */
export async function preprocess(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<PreparedFrame | null> {
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

  // The ratio travels with the tensor it scaled: decoding the boxes back to
  // frame coordinates must use the exact value the pixels were resized by.
  return { tensorData, usability: frameUsability(mean, stdDev), ratio };
}
