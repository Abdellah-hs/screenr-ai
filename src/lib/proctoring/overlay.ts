/**
 * Geometry for the live proctoring overlay on the candidate's self-view.
 *
 * The worker publishes boxes as fractions of the frame it scored. Turning those
 * into pixels on screen is not a scale factor — two transforms sit in between,
 * and getting either wrong puts boxes confidently in the wrong place:
 *
 *  1. `object-fit: cover` crops the video to fill its element. A 4:3 camera in a
 *     16:9 box loses a slice off each side, so the visible region is a window
 *     onto the frame, not the whole frame.
 *  2. The self-view is MIRRORED (`scaleX(-1)`), because a preview that doesn't
 *     mirror feels wrong to look at. The detector saw the unmirrored frame, so
 *     x must be flipped to match what the candidate is looking at.
 *
 * Pure and DOM-free so both can be tested without a browser — this is exactly
 * the kind of maths that looks right until someone tilts a webcam.
 */

/**
 * Data-channel topic the agent worker publishes boxes on. Mirrors
 * `VISION_OVERLAY_TOPIC` in agents/interview/src/vision.ts — the packet parser
 * and the topic it arrives on are one contract, so they live together.
 */
export const OVERLAY_TOPIC = "proctoring.boxes";

/** What a box means. Mirrors `SignalLabel` in the agent worker. */
export type OverlayBoxLabel = "person" | "phone";

/** One box as it arrives over the data channel: fractions of the source frame. */
export interface OverlayBox {
  label: OverlayBoxLabel;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** The published packet. Ephemeral — drawn and dropped, never persisted. */
export interface OverlayPacket {
  at: string;
  boxes: OverlayBox[];
}

/** A box positioned in the video element's own pixel space. */
export interface PlacedBox extends OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VideoGeometry {
  /** Intrinsic frame size (`video.videoWidth` / `videoHeight`). */
  frameWidth: number;
  frameHeight: number;
  /** Rendered element size (`clientWidth` / `clientHeight`). */
  elementWidth: number;
  elementHeight: number;
  /** Whether the element is mirrored horizontally. */
  mirrored: boolean;
}

/**
 * Parse a data-channel payload into boxes.
 *
 * Defensive because this is untrusted bytes off a network channel: anything
 * malformed yields null and the overlay simply doesn't update. A drawing bug
 * must never be able to take down a live interview.
 */
export function parseOverlayPacket(payload: Uint8Array): OverlayPacket | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (typeof parsed !== "object" || parsed === null) return null;

    const { at, boxes } = parsed as { at?: unknown; boxes?: unknown };
    if (typeof at !== "string" || !Array.isArray(boxes)) return null;

    const clean: OverlayBox[] = [];
    for (const raw of boxes) {
      if (typeof raw !== "object" || raw === null) continue;
      const b = raw as Record<string, unknown>;
      if (b.label !== "person" && b.label !== "phone") continue;
      if (
        typeof b.x !== "number" ||
        typeof b.y !== "number" ||
        typeof b.w !== "number" ||
        typeof b.h !== "number" ||
        !Number.isFinite(b.x) ||
        !Number.isFinite(b.y) ||
        !Number.isFinite(b.w) ||
        !Number.isFinite(b.h)
      ) {
        continue;
      }
      clean.push({
        label: b.label,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        score: typeof b.score === "number" && Number.isFinite(b.score) ? b.score : 0,
      });
    }

    return { at, boxes: clean };
  } catch {
    return null;
  }
}

/**
 * Map frame-fraction boxes onto the rendered video element.
 *
 * Solves the `object-fit: cover` crop directly: the video is scaled by whichever
 * axis needs the larger factor to fill the element, and the overflow on the
 * other axis is split evenly and clipped. A box's screen position is therefore
 * its frame position through that same scale, minus the cropped offset — which
 * can legitimately land outside the element for something at the very edge.
 */
export function placeBoxes(boxes: OverlayBox[], geometry: VideoGeometry): PlacedBox[] {
  const { frameWidth, frameHeight, elementWidth, elementHeight, mirrored } = geometry;
  if (frameWidth <= 0 || frameHeight <= 0 || elementWidth <= 0 || elementHeight <= 0) {
    return [];
  }

  const scale = Math.max(elementWidth / frameWidth, elementHeight / frameHeight);
  const displayedWidth = frameWidth * scale;
  const displayedHeight = frameHeight * scale;
  const offsetX = (displayedWidth - elementWidth) / 2;
  const offsetY = (displayedHeight - elementHeight) / 2;

  return boxes.map((box) => {
    const width = box.w * displayedWidth;
    const height = box.h * displayedHeight;
    const top = box.y * displayedHeight - offsetY;

    // Mirroring flips the box across the element's vertical centre. Done in the
    // maths rather than with a CSS transform on the overlay, so the labels
    // inside the boxes stay readable instead of coming out backwards.
    const left = mirrored
      ? elementWidth - (box.x * displayedWidth - offsetX) - width
      : box.x * displayedWidth - offsetX;

    return { ...box, left, top, width, height };
  });
}

/**
 * How long a box stays on screen without a refresh.
 *
 * Boxes are published roughly once a second; if that stops — the worker died,
 * the data channel dropped, the candidate's camera cut — the last frame's boxes
 * must disappear rather than hang over a scene they no longer describe. Well
 * over the publish interval so ordinary jitter doesn't make them flicker.
 */
export const OVERLAY_STALE_AFTER_MS = 3_000;

/**
 * What a box is *called* on the candidate's own screen.
 *
 * Display only, and one step removed from `OverlayBoxLabel` on purpose. The
 * worker reports "person" — it does not, and must not, decide which person is
 * the candidate. Naming one box "Face" and the rest "Second face" is a reading
 * made in the browser for the candidate's benefit, so they can see what the
 * camera has picked up and correct it. Nothing here reaches the report: that is
 * assembled server-side from the worker's own readings.
 */
export type OverlayDisplayLabel = "face" | "second_face" | "phone";

/**
 * The largest person box is taken to be the candidate — they are the one at the
 * keyboard, so they are the one closest to the camera. It is a heuristic, which
 * is exactly why it is confined to a caption on a live preview and never
 * anywhere a decision is made.
 */
export function displayLabels(boxes: OverlayBox[]): OverlayDisplayLabel[] {
  let primary = -1;
  let largest = -1;
  boxes.forEach((box, i) => {
    if (box.label !== "person") return;
    const area = box.w * box.h;
    if (area > largest) {
      largest = area;
      primary = i;
    }
  });

  return boxes.map((box, i) =>
    box.label === "phone" ? "phone" : i === primary ? "face" : "second_face",
  );
}
