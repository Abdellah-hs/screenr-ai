/**
 * Matching a model's quote against the text it was shown.
 *
 * **The one rule this file exists to hold: never award credit for a quote that
 * could not be found.** Every scored stage checks its evidence the same way -
 * a resume quote against the normalized document, a screening or interview
 * quote against the candidate's own half of the transcript - so the matcher
 * itself belongs here, with the ladder and the transcript rendering, rather
 * than with any one stage.
 *
 * It lived in `resume-scoring/validate.ts` and was imported from there by
 * `scoring/transcript-evidence.ts`, which inverted the dependency: the shared
 * kernel reached into a stage package, making the resume stage's helper
 * load-bearing for the two spoken ones. A change made for resume reasons would
 * have silently changed how a screening and an interview verify their quotes,
 * which is the drift `src/lib/scoring/` exists to prevent. `resume-scoring`
 * re-exports these under its own name, exactly as `screening-scoring`
 * re-exports the transcript and weight helpers, so its callers and tests are
 * untouched.
 */

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const QUOTE_CHARS = /[\u2018\u2019\u201A\u201B\u2032]/g;
const DOUBLE_QUOTE_CHARS = /[\u201C\u201D\u201E\u201F\u2033]/g;
const DASH_CHARS = /[\u2010-\u2015\u2212]/g;

/**
 * Fold away every difference that is not a difference in what was said:
 * Unicode composition, case, curly-vs-straight punctuation, and whitespace
 * (including the line breaks our own document builders insert).
 *
 * Deliberately conservative about what it does NOT remove - words, digits and
 * ordinary punctuation all survive, so this can widen a match but never invent
 * one between two genuinely different sentences.
 */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(QUOTE_CHARS, "'")
    .replace(DOUBLE_QUOTE_CHARS, '"')
    .replace(DASH_CHARS, "-")
    .replace(/\u2026/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `quote` appears in `sourceText`, ignoring only cosmetic differences. */
export function normalizedIncludes(sourceText: string, quote: string): boolean {
  const needle = normalizeForQuoteMatch(quote);
  if (!needle) return false;
  return normalizeForQuoteMatch(sourceText).includes(needle);
}
