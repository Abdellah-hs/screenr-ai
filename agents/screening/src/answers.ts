/**
 * The two things that stand between "the candidate stopped making noise" and
 * "we have their answer".
 *
 * Both exist because speech, transcription and the end of an answer are three
 * different events, and every time the worker has treated any two of them as
 * one it has cost a candidate words they actually said.
 */
import { FINAL_TURN_SETTLE_MS } from "./timing.js";

/** Everything the candidate has said on one question. */
export interface HeldAnswer {
  /** The fragments, in the order spoken, joined into one answer. */
  text: string;
  /**
   * The id of the last fragment folded in. One posted event needs one id, and
   * the app dedupes `turn_completed` on it.
   */
  eventId: string;
}

/**
 * Joins the fragments a paused answer arrives in.
 *
 * Keyed on the question sequence throughout: a fragment for a question the call
 * has left behind starts a fresh answer rather than being appended, so a late
 * arrival can never be handed to the evaluator as part of the answer to a
 * question the candidate had not yet heard.
 */
export interface AnswerAssembly {
  /** A finalized candidate turn on the question at `seq`. */
  fragment(seq: number, text: string, eventId: string): void;
  /** Take the whole answer for `seq`, clearing it. Null if nothing is held. */
  take(seq: number): HeldAnswer | null;
  /**
   * How many words are held for `seq`, across every fragment so far. 0 if
   * nothing is.
   *
   * Read to decide how long to wait for MORE. Somebody who has said three words
   * and gone quiet is almost always still thinking; somebody who has given
   * forty has answered, and a pause is the end of it.
   */
  wordCount(seq: number): number;
}

export function createAnswerAssembly(): AnswerAssembly {
  let held: { seq: number; parts: string[]; eventId: string } | null = null;

  return {
    fragment(seq, text, eventId) {
      const spoken = text.trim();
      if (!spoken) return;
      if (held?.seq !== seq) held = { seq, parts: [], eventId };
      held.parts.push(spoken);
      held.eventId = eventId;
    },

    wordCount(seq) {
      if (held?.seq !== seq) return 0;
      return held.parts.join(" ").split(/\s+/).filter(Boolean).length;
    },

    take(seq) {
      if (held?.seq !== seq) return null;
      const answer = { text: held.parts.join(" "), eventId: held.eventId };
      held = null;
      return answer;
    },
  };
}

/**
 * Holds the close until an answer we HEARD has actually arrived.
 *
 * `onInputSpeechStopped` fires when the candidate stops; the finalized
 * transcript item follows later, and only then is the answer in the draft.
 * `screening.finished` is what makes the browser submit against that draft, so
 * closing in the gap loses the last thing they said and nothing recovers it.
 *
 * The ordinary path cannot hit this — the transcript item is what posts
 * `turn_completed`, so a `close` cannot exist before it. The exposed path is
 * the answer timeout, which advances from a timer that knows nothing about a
 * transcript in flight.
 *
 * **It also COUNTS the answers it could not save** (decision 2026-08-28). This
 * barrier already holds the only state that can tell "they said nothing" from
 * "we failed to hear them" — speech observed against words arrived — and until
 * now it threw that distinction away everywhere except the close.
 *
 * The failure is real and it is silent. OpenAI Realtime is speech-to-speech, so
 * the model understands the audio natively and the conversation carries on
 * normally; the TEXT comes from a separate transcription sidecar, and when that
 * fails the plugin emits an EMPTY transcript, which `ConversationItemAdded`
 * drops on `if (!text) return`. The interviewer thanks them for an answer that
 * reached no transcript, the scorer reads the whole call and honestly reports
 * `not_present` for every rubric dimension, and the candidate scores 0 for an
 * answer they gave. On the calls this was found in, the interviewer's own words
 * ("Merci pour ta réponse") are the only surviving evidence they ever spoke.
 */
export interface FinalAnswerBarrier {
  /**
   * The candidate has begun answering the question at `seq`.
   *
   * Captured HERE rather than when the words come back: a late item from a
   * question that already timed out arrives once the next has been asked, and
   * an arrival-time sequence would match the current one and let it be graded
   * against a question the candidate had not yet heard.
   */
  speechStarted(seq: number): void;
  /** Their words have landed. */
  transcriptArrived(seq: number): void;
  /** The question an arriving transcript belongs to, or null if none is owed. */
  pendingSeq(): number | null;
  /**
   * Hold until the answer lands, or give up loudly. `arrived` lets a caller
   * that exists only to cover for a missing answer stand down when it turns up.
   */
  wait(why: string): Promise<{ waited: boolean; arrived: boolean }>;
  /**
   * The answers we heard the candidate give and never got words for, in the
   * order they were lost. Read at wind-down to report the call's own honesty.
   */
  lost(): LostAnswer[];
}

/** One answer the candidate gave that reached no transcript. */
export interface LostAnswer {
  /** The question that was on the floor when they started speaking. */
  questionSeq: number;
  /** What closed the book on it — the next question, or the end of the call. */
  why: string;
}

export function createFinalAnswerBarrier(options: {
  applicationId: string;
  /**
   * Drain whatever queue makes a transcript durable. Awaited only after the
   * item has arrived: flushing an array is not the same as the app having
   * received it, and `screening.finished` must follow the latter.
   */
  drainReports: () => Promise<void>;
  settleMs?: number;
  now?: () => number;
  onInfo?: (message: string) => void;
  onWarn?: (message: string) => void;
  /**
   * One answer was heard and never transcribed. Fired once per loss, so a
   * caller can report it while the call is still live.
   */
  onLost?: (lost: LostAnswer) => void;
}): FinalAnswerBarrier {
  const {
    applicationId,
    drainReports,
    settleMs = FINAL_TURN_SETTLE_MS,
    now = Date.now,
    onInfo = (m) => console.info(m),
    onWarn = (m) => console.warn(m),
    onLost = () => {},
  } = options;

  let pending: { seq: number; startedAt: number; settled: Promise<void>; resolve: () => void } | null =
    null;
  const losses: LostAnswer[] = [];

  /**
   * Book one loss.
   *
   * Structured, and carrying the application id, because this is the one class
   * of failure where the record disagrees with what actually happened: the
   * candidate answered and the transcript says they did not. Finding it later
   * must not require reading a whole call log.
   */
  const bookLoss = (seq: number, why: string, waitedMs: number) => {
    const lost: LostAnswer = { questionSeq: seq, why };
    losses.push(lost);
    onWarn(
      JSON.stringify({
        at: "screening.worker.answer_unheard",
        applicationId,
        questionSeq: seq,
        why,
        speechObserved: true,
        transcriptArrived: false,
        waitedMs,
      }),
    );
    onLost(lost);
  };

  return {
    speechStarted(seq) {
      if (pending?.seq === seq) return;
      // A previous question's turn never arrived. Release its waiters rather
      // than leaving a promise nobody will resolve — the call has moved on.
      //
      // **And that is a lost answer, unambiguously.** Every path that could
      // leave a transcript legitimately in flight has already been awaited by
      // the time the candidate is answering a NEW question: the timeout waits
      // on this barrier before it settles a topic, and the ordinary hand-off is
      // driven BY the transcript item itself. So an outstanding older question
      // here is one we heard them answer and never got the words for.
      if (pending) {
        bookLoss(pending.seq, "the call moved on to the next question", now() - pending.startedAt);
        pending.resolve();
      }

      let resolve!: () => void;
      const settled = new Promise<void>((r) => {
        resolve = r;
      });
      pending = { seq, startedAt: now(), settled, resolve };
    },

    transcriptArrived(seq) {
      if (pending?.seq !== seq) return;
      pending.resolve();
      pending = null;
    },

    pendingSeq: () => pending?.seq ?? null,

    async wait(why) {
      const outstanding = pending;
      // Nothing was heard, so nothing can be owed.
      if (!outstanding) return { waited: false, arrived: false };

      onInfo(`[flow] holding the close for the answer already spoken (${why})`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arrived = await Promise.race([
        outstanding.settled.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), settleMs);
        }),
      ]);
      if (timer) clearTimeout(timer);

      if (arrived) {
        await drainReports();
        return { waited: true, arrived: true };
      }

      // The close's own name for this is kept: it is what the runbook and
      // CLAUDE.md already point at, and it says which wait gave up. `bookLoss`
      // adds the generic line and the count beside it.
      onWarn(
        JSON.stringify({
          at: "screening.worker.final_turn_unsettled",
          applicationId,
          questionSeq: outstanding.seq,
          why,
          speechObserved: true,
          transcriptArrived: false,
          waitedMs: now() - outstanding.startedAt,
        }),
      );
      bookLoss(outstanding.seq, why, now() - outstanding.startedAt);
      // Give up for good, so a later arrival cannot hold the next close too.
      if (pending?.seq === outstanding.seq) {
        pending.resolve();
        pending = null;
      }
      return { waited: true, arrived: false };
    },

    lost: () => [...losses],
  };
}
