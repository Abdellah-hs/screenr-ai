/**
 * The countdown on the candidate's own screen.
 *
 * **Display only.** The interviewer moves on when the worker's timer says so,
 * identically for a candidate whose tab is backgrounded and rendering nothing.
 * But a deadline the product enforces is one the candidate is entitled to see:
 * the minute is only fair because they watch it fall for its whole length.
 */

/** Wire shape published on the `screening.answer` data topic (see `channel.ts`). */
export interface AnswerClockPacket {
  /** Milliseconds left when this was sent, or null to hide the counter. */
  remainingMs: number | null;
  /** True once the budget has run out. */
  expired: boolean;
  /**
   * Is the budget STOPPED because the interviewer is talking?
   *
   * Still the one counter — the same number standing still, not a second clock
   * counting down to something else. A counter that simply disappears while the
   * interviewer talks is absent for most of a screening call, which is how a
   * candidate ends up reporting there is no countdown at all.
   */
  paused: boolean;
}

export interface AnswerClock {
  /** Put a number on the screen, or take it off with `null`. */
  set(remainingMs: number | null, expired: boolean, reason: string, paused?: boolean): void;
  /** Stop re-sending. The call is over. */
  stop(): void;
}

/**
 * A data packet is NOT buffered for anyone who is not in the room at the moment
 * it is sent, so one send per question loses the countdown outright for a
 * browser reconnecting after a blip or still finishing its join. Re-sending
 * heals reconnects, late joins and dropped packets with one mechanism, and each
 * repeat doubles as a drift correction because the browser anchors to arrival.
 */
const HEARTBEAT_MS = 5000;

export function createAnswerClock(options: {
  /** Publish one packet. Best-effort; a browser that misses one shows a stale number. */
  send: (packet: AnswerClockPacket) => void;
  heartbeatMs?: number;
  onInfo?: (message: string) => void;
}): AnswerClock {
  const { send, heartbeatMs = HEARTBEAT_MS, onInfo = (m) => console.info(m) } = options;

  let clock: { remainingMs: number; at: number; paused: boolean } | null = null;
  let expiredNow = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stopHeartbeat = () => {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = undefined;
  };

  return {
    set(remainingMs, expired, reason, paused = false) {
      const was = clock !== null ? "shown" : "hidden";
      const shown =
        remainingMs === null
          ? "hidden"
          : `${Math.round(remainingMs / 1000)}s${paused ? " (paused)" : ""}`;
      onInfo(`[clock] ${was} -> ${shown}${expired ? " (expired)" : ""}  cause=${reason}`);

      clock = remainingMs === null ? null : { remainingMs, at: Date.now(), paused };
      expiredNow = expired;
      send({ remainingMs, expired, paused });

      if (clock === null) {
        stopHeartbeat();
        return;
      }
      if (heartbeat) return;
      heartbeat = setInterval(() => {
        const current = clock;
        if (current === null) {
          stopHeartbeat();
          return;
        }
        // A FROZEN clock re-sends the same number verbatim. Letting elapsed
        // time reduce it would count the interviewer's own airtime against the
        // candidate, which is the whole thing freezing exists to prevent.
        const remaining = current.paused
          ? current.remainingMs
          : Math.max(0, current.remainingMs - (Date.now() - current.at));
        send({ remainingMs: remaining, expired: expiredNow, paused: current.paused });
      }, heartbeatMs);
    },

    stop: stopHeartbeat,
  };
}
