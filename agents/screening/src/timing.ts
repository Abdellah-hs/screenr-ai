/**
 * Every duration the screening call runs on, in one place.
 *
 * They are separated from the logic because they are the settings most likely
 * to be tuned against a real call, and because two of them must agree with
 * numbers held in the app. No I/O, no state — read by the worker, enforced
 * there.
 */

/**
 * The per-answer budget, armed when a question FINISHES being spoken.
 *
 * The worker owns it because it is the only party that can see when its own
 * asking turn ended; the app stamps `answerDueAt` when it opens a topic, which
 * is several seconds earlier and once cost a candidate thirteen seconds of
 * their minute. Kept in step with `SCREENING_ANSWER_BUDGET_MS` in
 * src/lib/constants.ts by a test, so the number on screen and the number in
 * the ledger cannot drift.
 */
export const ANSWER_BUDGET_MS = 60_000;

/**
 * How long a silent room is left alone before the worker speaks anyway.
 *
 * With `create_response: false` nothing speaks unless the worker asks it to, so
 * a lost control response would leave a room where nothing ever says anything
 * again. Also the way out of an unanswered audio check — generous, because
 * silence there reads as somebody fighting a microphone permission dialog.
 */
export const SILENCE_NUDGE_MS = 20_000;

/**
 * How long one interviewer turn may take before the worker stops waiting on it.
 *
 * `generateReply` resolves on playout and the speech lane is single-file, so a
 * reply that never completes would stop every later turn, every answer timeout
 * and the silence watchdog itself.
 */
export const SPEAK_BACKSTOP_MS = 45_000;

/**
 * How long to wait for a candidate turn we KNOW is coming — speech was
 * observed — to arrive as a finalized transcript item.
 *
 * The browser submits on `screening.finished` and the server finalizes from
 * the draft this worker reported, so closing in the gap loses the last answer
 * for good. Bounded, because stranding somebody on a finished call is the
 * mirror-image failure: they close the tab and the expiry sweep rejects them
 * for an interview they sat.
 */
export const FINAL_TURN_SETTLE_MS = 8_000;

/**
 * How long to wait for a goodbye the worker asked for before closing anyway.
 *
 * A failure bound for the reply that is produced but never spoken, which
 * leaves no state change to close on.
 */
export const GOODBYE_BACKSTOP_MS = 25_000;

/**
 * How long a finalized candidate turn is held before it is treated as the
 * whole answer.
 *
 * A finalized turn is not a finished ANSWER: OpenAI's VAD ends the turn on a
 * beat of silence, and that turn is what asks the next question — so acting on
 * it immediately spends a topic on half an answer. If they start again inside
 * the window it was one answer all along.
 */
export const ANSWER_SETTLE_MS = 3_000;

/**
 * How long the interviewer will wait for a talking candidate before asking
 * anyway.
 *
 * The interviewer never starts a turn over the candidate: with barge-in on,
 * speaking across somebody gets the question cancelled partway through and the
 * clock is then armed on one they only half heard. Bounded, because a
 * candidate who does not stop cannot hold the interview up forever.
 */
export const SPEAK_HOLD_MS = 10_000;

/**
 * The same wait for the GOODBYE, and deliberately longer: nothing is waiting on
 * the ending, so the only cost of waiting is a few seconds on a call that is
 * already over — while cutting somebody off loses whatever they were saying,
 * because the browser submits on the close.
 */
export const CLOSE_HOLD_MS = 20_000;

/**
 * How long the room stays open after a sign-off that ended on a question.
 *
 * The interviewer is told not to ask anything in its goodbye, and sometimes
 * asks anyway. Since the room closes on that turn and the browser submits when
 * it does, the question would otherwise be put to somebody who is given no
 * chance to answer it — the call hanging up on them mid-thought.
 *
 * Twenty seconds because it is a real question and deciding how to answer takes
 * a beat; it ends the moment they stop talking, so a candidate who does answer
 * never waits this out. Bounded because dead air is not free either: a screen
 * that looks frozen is what makes people close the tab on a finished interview,
 * and nothing submits if they do.
 */
export const CLOSING_ANSWER_MS = 20_000;

/**
 * How few words means "they have not answered yet, they are thinking".
 *
 * The interviewer is forbidden from asking anything answerable with yes or no
 * — every question on this call wants the candidate to describe something — so
 * a handful of words is not a short answer, it is the start of one, or a
 * placeholder while they gather their thoughts. "I don't know." is three.
 */
export const SUBSTANTIAL_ANSWER_WORDS = 12;

/**
 * How long to hold a finished-looking turn, given how much has been said on it.
 *
 * `null` means **do not settle early at all** — their countdown carries the
 * answer, and the budget expiring flushes whatever is held.
 *
 * **The counter promises a minute, and a three-second pause was spending it.**
 * A candidate who said "I don't know." and stopped to think had their topic
 * settled on three words with fifty-five seconds still showing on their screen.
 * The settle window asks whether the UTTERANCE is over; the ANSWER was being
 * treated as over with it.
 *
 * Below the threshold the honest answer is that we cannot tell, so we stop
 * guessing and let the clock they can see decide. That is only affordable
 * because they can end it themselves (`SCREENING_DONE_TOPIC`) — without the
 * button this is fifty seconds of unskippable silence, which is what makes
 * people close the tab.
 *
 * Above it, a pause really is an ending and the ordinary window keeps a normal
 * call snappy. Re-read on every fragment, so somebody who opens with "Hmm."
 * waits on their clock and drops to the short window the moment they have
 * actually answered.
 */
export function answerHoldMs(wordsSoFar: number, answerSettle: number): number | null {
  // The kill switch stays a kill switch: nothing waits at all.
  if (answerSettle <= 0) return 0;
  return wordsSoFar >= SUBSTANTIAL_ANSWER_WORDS ? answerSettle : null;
}

/**
 * The same hold, for the reply to the AUDIO CHECK.
 *
 * "Can you hear me?" is answered with one word, so the three seconds an
 * interview answer needs are three seconds of nothing at the very start of the
 * call — the worst place in the whole conversation to put dead air, because a
 * candidate who has just joined has no way to tell a thinking interviewer from
 * a broken one. On a real call it lands as: they say "yes", and nothing happens
 * for about five seconds (this hold, plus transcription, plus the model
 * generating the first question).
 *
 * It is not zero, and that is deliberate. A candidate who says "yes —" and
 * keeps going ("…sorry, one second, let me close the door") would otherwise be
 * asked topic 1 over the top of themselves, and with barge-in on that question
 * is cancelled partway through and its minute armed on one they only half
 * heard. A second is long enough for somebody resuming a sentence and short
 * enough not to read as a stall.
 *
 * The evaluator round-trip is already skipped here for the same reason — the
 * reply to the audio check is not an answer to anything.
 */
export const GREETING_SETTLE_MS = 1_000;

/** The longest hold an operator may set, so a typo cannot stall a call. */
const MAX_ANSWER_SETTLE_MS = 10_000;

/** {@link ANSWER_SETTLE_MS}, with the operator override applied. `0` disables the hold. */
export function answerSettleMs(): number {
  const raw = Number(process.env.SCREENING_ANSWER_SETTLE_MS?.trim());
  if (!Number.isFinite(raw) || raw < 0) return ANSWER_SETTLE_MS;
  return Math.min(raw, MAX_ANSWER_SETTLE_MS);
}

/**
 * {@link GREETING_SETTLE_MS}, floored by whatever the answer hold is set to.
 *
 * Taking the smaller of the two means an operator who disables the hold
 * (`SCREENING_ANSWER_SETTLE_MS=0`) disables it everywhere, and one who
 * lengthens it for interview answers does not thereby lengthen the pause after
 * "can you hear me?" — which is the one place a longer hold buys nothing.
 */
export function greetingSettleMs(answerSettle: number): number {
  return Math.min(answerSettle, GREETING_SETTLE_MS);
}

/** How readily the model decides the candidate has finished speaking. */
export type VadEagerness = "auto" | "low" | "medium" | "high";

const VAD_EAGERNESS_VALUES: readonly VadEagerness[] = ["auto", "low", "medium", "high"];

/**
 * Low, and the default matters more than the value: the plugin ships
 * `semantic_vad` at "medium", tuned for conversation rather than for interview
 * answers. Thinking mid-sentence is what a good answer sounds like, and a turn
 * ending is what decides the next question — so an eager detector does not
 * merely interrupt, it spends a topic on a fragment.
 */
export function screeningVadEagerness(): VadEagerness {
  const raw = process.env.SCREENING_VAD_EAGERNESS?.trim().toLowerCase();
  return VAD_EAGERNESS_VALUES.find((value) => value === raw) ?? "low";
}

/**
 * How long to wait on one control post.
 *
 * Two budgets, because the two kinds of call have opposite needs. A call that
 * decides the next question is one the candidate is sitting in silence
 * through, and it runs the turn evaluator on top of the database round-trips,
 * so it gets the generous budget. Everything else is posted after the
 * interviewer has already spoken, so nobody is waiting on it.
 */
export function controlTimeoutMs(decidesNextQuestion: boolean): number {
  const override = Number(
    decidesNextQuestion
      ? process.env.SCREENING_REPORT_TIMEOUT_MS
      : process.env.SCREENING_CONTROL_TIMEOUT_MS,
  );
  if (Number.isFinite(override) && override > 0) return override;
  return decidesNextQuestion ? 25_000 : 6_000;
}
