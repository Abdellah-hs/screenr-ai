import type { TranscriptTurn } from "./evidence";

/**
 * Render the transcript exactly as the model will be shown it.
 *
 * The same string is the prompt input AND the corpus every quote is verified
 * against. Building it once, here, is what makes verification meaningful: if
 * the prompt showed one rendering and the verifier searched another, a quote
 * could be genuinely present in what the model read and still fail to check
 * out — or worse, pass against text the model never saw.
 */
export function buildTranscriptDocument(transcript: TranscriptTurn[]): string {
  return transcript
    .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");
}

/**
 * Only the candidate's own words, joined for quote verification.
 *
 * Verification runs against this rather than the full document on purpose: a
 * quote lifted from the *interviewer's* turn would otherwise verify cleanly and
 * award credit for the question having been asked. The model is told to quote
 * the candidate only; this is the half that enforces it.
 */
export function buildCandidateSpeech(transcript: TranscriptTurn[]): string {
  return transcript
    .filter((t) => t.role === "candidate")
    .map((t) => t.text)
    .join("\n");
}

/** Whether anyone actually spoke as the candidate. */
export function hasCandidateSpeech(transcript: TranscriptTurn[]): boolean {
  return transcript.some((t) => t.role === "candidate" && t.text.trim().length > 0);
}
