/**
 * The LiveKit data-channel topics the worker and the candidate's browser use.
 *
 * Both must stay in sync with src/components/realtime/voice-screening.tsx. The
 * two packages deploy separately, so a name changed on one side fails silently
 * on the other — the candidate simply never sees a countdown, or is never told
 * the call is over, with no error anywhere.
 */

/**
 * Says the interview is genuinely over. Carries no content — only the fact. The
 * browser reacts by submitting, and the server finalizes from the transcript IT
 * already holds, so nothing the candidate's machine could forge changes what is
 * recorded.
 */
export const SCREENING_FINISHED_TOPIC = "screening.finished";

/**
 * Carries the per-answer countdown. REMAINING milliseconds, never an absolute
 * deadline: the browser anchors to arrival, so a candidate whose system clock
 * is wrong still sees the right number.
 */
export const SCREENING_ANSWER_TOPIC = "screening.answer";

/**
 * The candidate saying they have finished answering — the ONE packet that
 * travels browser → worker.
 *
 * It exists so the countdown can be honest. Without it the worker has to guess
 * that an answer is over from a pause, and a guess that is wrong either spends
 * somebody's topic while they are still thinking or leaves them staring at
 * fifty seconds of silence they cannot skip. With a way to say "I'm done", the
 * default can simply be their whole minute.
 *
 * **It carries no content, and could not be trusted with any.** The transcript
 * is what this worker reported and the app decides every question, so the worst
 * a forged packet can do is end the sender's own answer early — which is the
 * button's entire purpose.
 */
export const SCREENING_DONE_TOPIC = "screening.done";
