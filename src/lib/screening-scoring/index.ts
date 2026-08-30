/**
 * Deterministic voice-screening scoring.
 *
 * The model reads a transcript and reports evidence. Everything that decides
 * anything — per-question scores, the overall — happens here, in pure functions
 * with no network and no clock. The mirror image of `src/lib/resume-scoring/`,
 * on the same evidence ladder (`src/lib/scoring/evidence-levels.ts`).
 *
 * See CLAUDE.md → "Control > AI > Data".
 */
export * from "./dimensions";
export * from "./evidence";
export * from "./transcript";
export * from "./validate";
export * from "./deterministic";
