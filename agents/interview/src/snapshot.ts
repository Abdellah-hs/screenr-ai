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

/** Which finding a snapshot is evidence for. Mirrors `VisionIncidentType`. */
export type SnapshotCondition = "person_absent" | "multiple_people" | "phone_visible";

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
  rgba: Buffer,
  width: number,
  height: number,
  boxes: OverlayBox[],
): Promise<Buffer | null> {
  try {
    const base = sharp(rgba, { raw: { width, height, channels: 4 } }).resize(
      SNAPSHOT_WIDTH,
      null,
      { withoutEnlargement: true },
    );

    // Round-trip through a buffer to learn the post-resize dimensions, so the
    // SVG overlay is built at exactly the size it will be composited onto.
    const { data, info } = await base
      .jpeg({ quality: SNAPSHOT_QUALITY })
      .toBuffer({ resolveWithObject: true });

    if (boxes.length === 0) return data;

    return await sharp(data)
      .composite([{ input: annotationSvg(boxes, info.width, info.height), top: 0, left: 0 }])
      .jpeg({ quality: SNAPSHOT_QUALITY })
      .toBuffer();
  } catch (err) {
    console.error(
      "vision snapshot encode failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Which finding, if any, a reading is evidence of.
 *
 * Mirrors `conditionsOf` in the app's rule layer, but returns a single condition
 * because a snapshot is one image: when a frame carries both a second person and
 * a phone, the extra person is the more serious claim and gets the attribution.
 * The app still derives both incidents from the counts — this only labels which
 * finding the picture is filed under.
 */
export function snapshotCondition(reading: {
  person_count: number;
  phone_count: number;
}): SnapshotCondition | null {
  if (reading.person_count >= 2) return "multiple_people";
  if (reading.person_count === 0) return "person_absent";
  if (reading.phone_count >= 1) return "phone_visible";
  return null;
}
