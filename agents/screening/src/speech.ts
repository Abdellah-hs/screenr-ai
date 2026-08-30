/**
 * The one lane the interviewer speaks in.
 *
 * There is one room and one voice, so there is one lane. Under the state
 * machine two speaking turns cannot legally overlap anyway — it only speaks on
 * entering GREETING, ASKING, FINISHING or FAILED, and each waits for its turn
 * to end — but a backend error landing mid-greeting is a genuine overlap, and
 * this is what makes it queue rather than collide.
 */

export interface Speaker {
  /**
   * Say one thing, and enqueue `ends` when the turn is over — however it ended.
   *
   * A turn that ended in no event at all is a room nobody will drive again,
   * which is the one failure `create_response: false` introduces.
   */
  speak(instruction: string, why: string, ends: () => void): void;
  /**
   * End the turn being spoken, exactly once.
   *
   * Two things observe a turn ending and either may be first: the session's own
   * state change leaving "speaking", and `generateReply` resolving on playout.
   * Both call this; the second is a no-op, so one turn produces exactly one
   * ending event and the machine cannot be moved twice by the same turn.
   */
  endCurrentTurn(): void;
  /** Resolves when everything queued so far has been spoken or given up on. */
  drain(): Promise<void>;
}

export function createSpeaker(options: {
  /**
   * Ask the model for one turn. Resolves on playout.
   *
   * It also resolves on a CANCELLED playout, which used to matter a great deal
   * — a candidate talking over the sign-off stopped it, and the returning
   * promise looked exactly like a goodbye that had been heard. Barge-in is off
   * on both sides now (OpenAI's `interrupt_response` and the handle's own
   * `allowInterruptions`), so nothing the candidate does can cancel a turn and
   * the two cases have collapsed into one.
   *
   * `PromiseLike` rather than `Promise`, because the plugin hands back a
   * thenable `SpeechHandle` rather than a real promise.
   */
  generateReply: (instructions: string) => PromiseLike<unknown>;
  /**
   * How long one turn may take before the worker stops waiting on it.
   *
   * The lane is single-file, so a reply that never completes would stop every
   * later turn, every answer timeout and the silence watchdog itself.
   * Overshooting means walking away from audio that may still be playing, which
   * is untidy; deadlocking abandons the candidate mid-interview.
   */
  backstopMs: number;
  /** True once the room has closed and a queued turn should be dropped. */
  isClosed: () => boolean;
  onInfo?: (message: string) => void;
  onError?: (message: string, err: unknown) => void;
}): Speaker {
  const {
    generateReply,
    backstopMs,
    isClosed,
    onInfo = (m) => console.info(m),
    onError = (m, err) => console.error(m, err instanceof Error ? err.message : err),
  } = options;

  let lane: Promise<void> = Promise.resolve();
  let endTurn: (() => void) | undefined;

  return {
    speak(instruction, why, ends) {
      let fired = false;
      const finish = () => {
        if (fired) return;
        fired = true;
        if (endTurn === finish) endTurn = undefined;
        ends();
      };

      lane = lane.then(async () => {
        // The room closed while this was queued.
        if (isClosed()) {
          finish();
          return;
        }
        endTurn = finish;
        onInfo(`[speech] start — ${why}`);
        try {
          await Promise.race([
            generateReply(instruction),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("generateReply did not complete")), backstopMs),
            ),
          ]);
          onInfo(`[speech] end — ${why}`);
        } catch (err) {
          onError(`failed to speak (${why}):`, err);
        } finally {
          // Whether it was said, cut off, or never happened, the turn is over.
          finish();
        }
      });
    },

    endCurrentTurn() {
      endTurn?.();
    },

    drain: () => lane.catch(() => undefined),
  };
}
