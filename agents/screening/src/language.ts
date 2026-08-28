/**
 * Which language the call is held in, chosen by the candidate.
 *
 * It used to be the model's call: the prompt said "greet in English, then match
 * whatever language their first real answer is in". Two things went wrong with
 * that. The interviewer is given the candidate's name and a summary of their
 * CV, so it INFERRED a language and opened the call in it — somebody who wanted
 * English was greeted in French before saying a word. And "match their
 * language" is a judgement the model re-makes on every turn, so it drifts.
 *
 * **The candidate now picks before the room is created**, on the page in front
 * of them, and the choice rides in on room metadata. So it is a fact by the
 * time the interviewer opens its mouth rather than something inferred from it —
 * which is the difference between deterministic and usually-right.
 *
 * The worker then repeats it on every instruction it sends. The model keeps the
 * wording, the warmth and the accent, and has no discretion over the decision:
 * the same division of labour as the questions themselves.
 */

/** The languages the greeting offers. */
export type CallLanguage = "english" | "french";

/**
 * Read the language off the room, defensively.
 *
 * It arrives as JSON in room metadata, which is set server-side from a value
 * the app already parsed as a closed enum — but this worker deploys separately
 * from the app, so it re-checks rather than trusting the wire. **Anything
 * unrecognised is `null`, never a guess**: an unpinned call matches whatever
 * the candidate speaks, which is the safe answer when we do not know, whereas
 * a wrong pin runs the whole interview in a language they did not ask for.
 *
 * Nothing outside this list may ever reach the prompt. The value is written
 * into the interviewer's own instructions, so accepting free text here would
 * let a candidate write their own directive into it.
 */
export function readCallLanguage(value: unknown): CallLanguage | null {
  return value === "english" || value === "french" ? value : null;
}

/**
 * The line prepended to every instruction the interviewer is given, once the
 * candidate has chosen.
 *
 * Repeated on EVERY turn rather than set once at the top of the call. A
 * Realtime model drifts back toward the language of what it was last given —
 * and the questions reach it in English, which pulls it toward English on every
 * single turn of a French call.
 */
export function speakIn(language: CallLanguage | null): string {
  if (!language) return "";
  const name = language === "french" ? "French" : "English";
  return (
    `Speak ${name}. The candidate chose ${name} for this call, so every word you say ` +
    `is in ${name} — including this turn. Never switch, never comment on the language, ` +
    "and never apologise for it.\n\n"
  );
}
