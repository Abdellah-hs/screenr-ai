/**
 * Deterministic resume screening.
 *
 * The model reads a CV and reports evidence. Everything that decides anything —
 * scores, gates, ranking, tier — happens here, in pure functions with no
 * network and no clock. See CLAUDE.md → "Control > AI > Data".
 */
export * from "./criteria";
export * from "./evidence";
export * from "./document";
export * from "./validate";
export * from "./deterministic";
export * from "./cache-key";
export * from "./audit";
