/**
 * Manual smoke tool for the proctoring detector.
 *
 *   pnpm tsx scripts/detect.ts <image.jpg> [...]
 *
 * Runs the real `detectFrame` path over a still image and prints what the worker
 * would have reported for it, plus timing. Point it at webcam screenshots — one
 * person, two people, a phone held up, a dark room — to sanity-check the
 * thresholds against your actual camera before trusting a live interview.
 *
 * Not a test: it needs images that don't belong in the repo, and it asserts
 * nothing. The pure decision logic is covered by `src/postprocess.test.ts`.
 */
import sharp from "sharp";
import { detectFrame } from "../src/detector.js";

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("usage: pnpm tsx scripts/detect.ts <image> [...]");
    process.exitCode = 1;
    return;
  }

  for (const path of paths) {
    try {
      // Mirrors what the worker gets off the LiveKit track: raw RGBA pixels.
      const { data, info } = await sharp(path)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const startedAt = Date.now();
      const reading = await detectFrame(data, info.width, info.height);
      const elapsedMs = Date.now() - startedAt;

      if (!reading) {
        console.log(`${path}: unreadable (no reading reported)  [${elapsedMs}ms]`);
        continue;
      }

      console.log(
        `${path}: ${info.width}x${info.height}  people=${reading.person_count}  ` +
          `phones=${reading.phone_count}  confidence=${reading.confidence.toFixed(2)}` +
          `${reading.confidence < 0.6 ? "  (DISCARDED by the rule layer)" : ""}  [${elapsedMs}ms]`,
      );
    } catch (err) {
      console.error(`${path}: failed —`, err instanceof Error ? err.message : err);
    }
  }
}

void main();
