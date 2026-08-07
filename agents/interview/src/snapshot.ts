/**
 * Evidence snapshots for camera proctoring findings.
 *
 * When a sampled frame carries a finding — someone else in shot, nobody in
 * shot, a phone in view — this turns that one frame into a small annotated JPEG
 * so a recruiter can see what the detector saw. It exists because the interview
 * is not recorded: without it, an automated accusation would reach a hiring
 * decision with nothing behind it that a human could check.
 *
 * Two properties keep this from drifting back into surveillance:
 *
 *  1. Only flagged frames are ever encoded. A clean interview produces no image
 *     at all, and the frames of a candidate doing nothing wrong are discarded
 *     the moment they are scored, exactly as before.
 *  2. What survives is decided later. The worker captures while a condition
 *     holds; the app deletes anything that didn't land inside a CONFIRMED
 *     incident at submit. The frames behind the system's own false positives
 *     are therefore the ones thrown away.
 *
 * The boxes are drawn ON the stored image on purpose. A bare photo of a
 * candidate says nothing; a photo with "person 0.91 / phone 0.63" drawn on it
 * shows the reader precisely what was claimed and lets them disagree with it.
 */
import sharp from "sharp";
import type { OverlayBox } from "./postprocess.js";

/**
 * Stored width. Big enough to recognise a face and read a phone in someone's
 * hand, small enough that a handful of these is a rounding error next to the
 * 30MB recordings this replaced.
 */
const SNAPSHOT_WIDTH = 640;

/** Visibly compressed, but the question here is "who/what", not fine detail. */
const SNAPSHOT_QUALITY = 72;

const BOX_COLOR: Record<OverlayBox["label"], string> = {
  person: "#22C55E",
  phone: "#F59E0B",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the annotation layer as SVG, sized to the OUTPUT image.
 *
 * Boxes arrive as frame fractions, which is what makes this straightforward:
 * they scale to whatever the snapshot's dimensions turn out to be, so the
 * annotation can never drift out of register with the image under it.
 *
 * Not mirrored, unlike the candidate's live self-view — this is the frame as the
 * camera saw it, which is the honest thing to store as evidence.
 */
function annotationSvg(boxes: OverlayBox[], width: number, height: number): Buffer {
  const parts = boxes.map((box) => {
    const x = Math.max(0, box.x * width);
    const y = Math.max(0, box.y * height);
    const w = Math.max(1, box.w * width);
    const h = Math.max(1, box.h * height);
    const color = BOX_COLOR[box.label];
    const label = escapeXml(`${box.label} ${Math.round(box.score * 100)}%`);
    // Keep the caption inside the image when the box starts at the very top.
    const labelY = y < 16 ? y + h + 14 : y - 5;

    return (
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `fill="none" stroke="${color}" stroke-width="3" rx="4" />` +
      `<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" font-family="sans-serif" font-size="14" ` +
      `font-weight="bold" fill="${color}" stroke="#000000" stroke-width="0.5">${label}</text>`
    );
  });

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`,
  );
}

/**
 * Encode one flagged frame as an annotated JPEG.
 *
 * Returns null on any failure. Snapshotting is the most optional thing in this
 * worker: losing one costs a recruiter a thumbnail, so it must never be able to
 * disturb sampling, the report, or the call.
 */
export async function encodeSnapshot(
  rgba: Uint8Array,
  width: number,
  height: number,
  boxes: OverlayBox[],
): Promise<Buffer | null> {
  try {
    // Compute the output size rather than round-tripping through a buffer to
    // discover it. One encode instead of two: half the work, and — the reason
    // that matters — the stored image is quantized once, not twice. It is the
    // thing a recruiter is asked to check a finding against.
    const outWidth = Math.min(SNAPSHOT_WIDTH, width);
    const outHeight = Math.max(1, Math.round((height * outWidth) / width));

    const pipeline = sharp(rgba, { raw: { width, height, channels: 4 } }).resize(
      outWidth,
      outHeight,
      { fit: "fill" },
    );

    if (boxes.length > 0) {
      pipeline.composite([
        { input: annotationSvg(boxes, outWidth, outHeight), top: 0, left: 0 },
      ]);
    }

    return await pipeline.jpeg({ quality: SNAPSHOT_QUALITY }).toBuffer();
  } catch (err) {
    console.error(
      "vision snapshot encode failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * A private throttling key for "frames that look like this", or null when the
 * frame looks ordinary and is not worth encoding at all.
 *
 * Deliberately NOT the incident vocabulary. Naming the finding is the rule
 * layer's job (`primaryCondition` in the app), and duplicating that judgement
 * here would mean a threshold change on one side silently leaves the worker
 * photographing a condition the rules no longer recognise. All this decides is
 * how often to spend an encode — an approximation is fine, and being wrong
 * costs a redundant image rather than a mislabelled one.
 */
export function snapshotBucket(reading: {
  person_count: number;
  phone_count: number;
}): string | null {
  const people = reading.person_count === 1 ? null : `people:${reading.person_count}`;
  const phone = reading.phone_count >= 1 ? "phone" : null;
  if (!people && !phone) return null;
  return [people, phone].filter(Boolean).join("+");
}
