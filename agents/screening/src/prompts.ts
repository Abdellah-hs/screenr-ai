import { speakIn, type CallLanguage } from "./language.js";

/**
 * Everything the interviewer is told to say.
 *
 * The app decides WHICH question; these decide how it is put. The interviewer
 * keeps the wording, the warmth and the language — the part a model is better
 * at than a template — and has no discretion over the question itself, which is
 * the discretion it once spent a whole call improvising with.
 *
 * Every instruction ends by telling it to stop talking: a Realtime model asked
 * for a turn will happily deliver a question and then answer it, and the
 * candidate's own words are the only thing this stage scores.
 */

/** Ask one question, in the interviewer's own words. */
export function instructionForQuestion(question: string, language: CallLanguage | null): string {
  return (
    speakIn(language) +
    "Ask the candidate this, and only this:\n\n" +
    `"${question}"\n\n` +
    "Put it in your own words, warmly and conversationally, as though it were simply " +
    "the next thing you wanted to know - never read it out as written and never as an " +
    "item from a list. The question above is written in English because that is how it " +
    "is stored; ask it in the language of this call. Do not preface it by saying you are " +
    "moving on, do not number it, and do not mention how many questions are left. Ask " +
    "it, then STOP TALKING and let them answer."
  );
}

/**
 * The greeting: an audio check, and it stops.
 *
 * It used to be told to greet AND ask topic 1, which produced exactly what
 * those words invite — "I can hear you clearly, hope you can hear me too" —
 * and then silence, while the ledger recorded topic 1 as asked and started its
 * minute on a hello. An audio check nobody is allowed to answer is not a check.
 */
export function greetingInstructions(language: CallLanguage | null): string {
  return (
    speakIn(language) +
    "Greet the candidate warmly by name in one short sentence, then ask whether they can " +
    "hear you clearly. Ask NOTHING else - no interview question yet - and stop talking so " +
    "they can answer."
  );
}

/**
 * The goodbye, always spoken and always by request.
 *
 * The worker knows the call is over before the interviewer does. Guessing from
 * silence instead meant a call that merely trailed off was submitted into what
 * the candidate heard as a dropped line.
 *
 * **It must not end on a question, and saying so once was not enough.** This
 * turn is the last thing spoken: the room closes when it finishes and the
 * browser submits on that. So a sign-off that ends "…is there anything you'd
 * like to add?" asks a real question and then hangs up on the answer.
 *
 * "Do not ask them anything further" was already here and did not hold —
 * closing an interview by inviting questions is one of the strongest habits a
 * model has, and a negation is the weakest way to argue with one. The line is
 * now positive (say what the final sentence must BE), names the two forms it
 * actually takes, and gives the model somewhere to put the impulse: their
 * questions have a real answer, and it is the hiring team's email.
 *
 * The prompt is still only the first half. `endsOnAQuestion` catches what gets
 * through — see the closing window in machine.ts.
 */
/** The sign-off, in the language the candidate chose. */
export function goodbyeInstructions(language: CallLanguage | null): string {
  return speakIn(language) + GOODBYE_INSTRUCTIONS;
}

export const GOODBYE_INSTRUCTIONS =
  "Bring the call to a close now. Thank them warmly for their time and tell them the " +
  "hiring team will follow up by email. " +
  "Your last sentence must be a STATEMENT that closes the call — never a question. " +
  "Do not ask whether they have questions for you, do not ask whether there is anything " +
  "they would like to add, and do not invite them to say anything else: the call ends on " +
  "your words, so anything you ask here goes unanswered. If they have asked you something " +
  "you cannot answer, say the hiring team will cover it by email. " +
  "The last thing they said may have been very short, or they may have said they do not " +
  "know. That is a complete answer and the interview is over: do not rephrase the question, " +
  "do not try a different angle, do not offer a hint or an easier version, and do not " +
  "reassure them that being unsure is fine. Close the call exactly as you would after " +
  "their best answer. " +
  "Then stop talking. Do not tell them to click or press anything, and never mention time, " +
  "topics, or that anything is being managed.";

/**
 * The one sentence a failed call is allowed to say.
 *
 * `FAILED` is not silence — a candidate whose interview stops has to be told
 * something. It deliberately does not say "please try again": whether they get
 * another link is the recruiter's decision, and the room is about to close, so
 * a question here would be answered into nothing.
 */
/** The one sentence a failed call says, in the language the candidate chose. */
export function technicalFailureInstructions(language: CallLanguage | null): string {
  return speakIn(language) + TECHNICAL_FAILURE_INSTRUCTIONS;
}

export const TECHNICAL_FAILURE_INSTRUCTIONS =
  "Tell the candidate, warmly and in one short sentence, that a technical problem has " +
  "ended the interview early and that the hiring team will be in touch by email. Then " +
  "stop talking. Do not ask them anything, do not apologise at length, do not tell them " +
  "to click or press anything, and do not blame them or their connection.";
