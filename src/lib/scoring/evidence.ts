/**
 * Grounding a score in the words behind it (PRD 3.10.2, 3.4.4).
 *
 * Both scorers already verify that a model's `evidence_quote` really appears in
 * the candidate's speech and zero the score when it does not — that backstop is
 * the strongest part of the scoring pipeline and this does not change it. What
 * was missing is that the verification then threw the quote away: it located
 * the evidence, decided the score could stand, and persisted neither the quote
 * nor where it was found. A manager was left with a number and no way back to
 * the sentence that produced it.
 *
 * Pure and shared, because two copies of "does this quote appear in the
 * transcript" is two copies of the anti-hallucination rule, and they would
 * drift.
 */

/** The shape both transcripts share — screening voice and AI interview alike. */
export interface EvidenceTurn {
  role: string;
  text: string;
}

/**
 * Lowercase and strip non-alphanumerics, so a verbatim quote survives minor
 * punctuation and spacing differences but a fabricated one still does not
 * match.
 *
 * Deliberately lossy in one direction only: it forgives how the model
 * transcribed the words, never which words they were.
 */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface LocatedEvidence {
  /** Index into the ORIGINAL transcript array, agent turns included. */
  turnIndex: number;
  /** The quote as the model gave it — the anchor is the index, not this. */
  quote: string;
}

/**
 * Find which candidate turn a quote came from.
 *
 * Searches turn by turn rather than against the concatenated speech, because a
 * position in a joined string is not something the UI can link to. A quote that
 * only matches once the turns are glued together — the model having stitched
 * two separate utterances into one "verbatim" quote — deliberately does NOT
 * locate here: it is not something the candidate said in one breath, and
 * pointing a manager at either half would misrepresent it.
 *
 * Returns null for an empty quote, an ungrounded one, or one that spans turns.
 * The caller decides what that means; on both stages it already means the
 * score cannot stand above zero.
 */
export function locateEvidence(
  quote: string,
  transcript: EvidenceTurn[],
  candidateRole: string = "candidate",
): LocatedEvidence | null {
  const needle = normalizeForMatch(quote);
  if (needle.length === 0) return null;

  for (let i = 0; i < transcript.length; i += 1) {
    const turn = transcript[i];
    if (turn.role !== candidateRole) continue;
    if (normalizeForMatch(turn.text).includes(needle)) {
      return { turnIndex: i, quote: quote.trim() };
    }
  }

  return null;
}

/**
 * Whether a quote appears anywhere in the candidate's speech, turns joined.
 *
 * This is the original grounding check and stays exactly as strict as it was —
 * a score is not demoted merely because its quote spans two turns, which would
 * be a behaviour change smuggled in under a UI feature. `locateEvidence` is the
 * narrower question of whether we can *link* to it.
 */
export function isGrounded(
  quote: string,
  transcript: EvidenceTurn[],
  candidateRole: string = "candidate",
): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length === 0) return false;

  const speech = normalizeForMatch(
    transcript
      .filter((t) => t.role === candidateRole)
      .map((t) => t.text)
      .join(" "),
  );

  return speech.includes(needle);
}
