import type { VoiceTranscriptTurn } from "@/lib/data/screening-questions";

/**
 * Soft "reads-as-scripted" signal derived from voice-screening cadence (#84).
 *
 * IMPORTANT: this is a *nudge, not proof* (Control > AI > Data). It never
 * feeds the advancement decision — `evaluateScreeningScoringOutcome` reads the
 * AI content score only. It is persisted as evidence and surfaced to the
 * recruiter, who applies judgement. A fast, fluent expert and a candidate
 * reading prepared answers can both produce a "high" signal; the recruiter
 * disambiguates.
 *
 * The only timing data we have is the gap between the interviewer's spoken
 * turn completing and the candidate's reply being transcribed. That gap mixes
 * think-time with speaking time, so the heuristic stays deliberately coarse.
 */
export type ScriptedSignal = "low" | "medium" | "high";

export interface TranscriptCadenceSignal {
  scripted_signal: ScriptedSignal;
  /** Median seconds between a question finishing and the reply landing; null if unmeasurable. */
  median_response_seconds: number | null;
  /** Number of question→answer exchanges we could actually time. */
  measured_responses: number;
  /** Human-readable explanation for the recruiter. */
  rationale: string;
}

// A reply landing within this many seconds of the question leaves little room
// for a thinking pause — a weak indicator of a pre-prepared answer.
const FAST_RESPONSE_SECONDS = 2;
// Below this many timed exchanges there isn't enough signal to say anything.
const MIN_MEASURED_RESPONSES = 2;
// Share of "fast" replies that tips the signal up.
const HIGH_FAST_RATIO = 0.6;
const MEDIUM_FAST_RATIO = 0.3;

function parseMs(at: string): number | null {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(raw * 10) / 10;
}

/**
 * Pure analysis: walks the transcript and times each question→answer exchange,
 * pairing every candidate reply with the most recent preceding agent turn.
 * Pairs with missing/unparseable/out-of-order timestamps are skipped. A second
 * consecutive candidate turn is not double-counted — only the first reply after
 * a question is timed.
 */
export function analyzeTranscriptCadence(
  transcript: VoiceTranscriptTurn[],
): TranscriptCadenceSignal {
  const latencies: number[] = [];
  let pendingAgentMs: number | null = null;

  for (const turn of transcript) {
    const ms = parseMs(turn.at);
    if (turn.role === "agent") {
      pendingAgentMs = ms; // null when the timestamp is unparseable
      continue;
    }
    // candidate turn
    if (pendingAgentMs !== null && ms !== null && ms >= pendingAgentMs) {
      latencies.push((ms - pendingAgentMs) / 1000);
    }
    pendingAgentMs = null; // a reply consumes the question, even if unmeasurable
  }

  const measured = latencies.length;
  const medianSeconds = measured > 0 ? median(latencies) : null;

  if (measured < MIN_MEASURED_RESPONSES) {
    return {
      scripted_signal: "low",
      median_response_seconds: medianSeconds,
      measured_responses: measured,
      rationale:
        measured === 0
          ? "No measurable question→answer exchanges in the transcript."
          : "Not enough timed exchanges to assess response cadence.",
    };
  }

  const fast = latencies.filter((l) => l <= FAST_RESPONSE_SECONDS).length;
  const ratio = fast / measured;

  let scripted_signal: ScriptedSignal = "low";
  if (ratio >= HIGH_FAST_RATIO) scripted_signal = "high";
  else if (ratio >= MEDIUM_FAST_RATIO) scripted_signal = "medium";

  const pct = Math.round(ratio * 100);
  return {
    scripted_signal,
    median_response_seconds: medianSeconds,
    measured_responses: measured,
    rationale: `${fast}/${measured} replies (${pct}%) landed within ${FAST_RESPONSE_SECONDS}s of the question (median ${medianSeconds}s). Treat as a soft signal only.`,
  };
}
