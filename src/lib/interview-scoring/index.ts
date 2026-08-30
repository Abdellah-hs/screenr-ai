/**
 * Deterministic AI-interview scoring.
 *
 * The model reads a transcript and reports evidence. Everything that decides
 * anything — per-dimension scores, the overall — happens here, in pure
 * functions with no network and no clock. The mirror image of
 * `src/lib/screening-scoring/`, on the same evidence ladder
 * (`src/lib/scoring/evidence-levels.ts`) and through the same reporting shape
 * and validator (`src/lib/scoring/transcript-evidence.ts`).
 *
 * See CLAUDE.md → "Control > AI > Data".
 */
export * from "./dimensions";
export * from "./evidence";
export * from "./deterministic";
