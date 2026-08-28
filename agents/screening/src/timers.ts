/**
 * The worker's timers, named and held in one place.
 *
 * Every timer here exists to produce ONE event and then be forgotten. None of
 * them changes state and none is read by anything that decides, which is what
 * stops them racing each other. They were five loose `let` bindings with four
 * near-identical clear helpers; the bug that shape invites is a timer cleared
 * on one path and left running on another.
 */

/** What each timer is for. */
export type TimerName =
  /** The candidate's minute, or the watchdog on a room nobody is driving. */
  | "listen"
  /** Holds a finished-looking answer to see whether it resumes. */
  | "settle"
  /** Bounds how long a question is held back for a candidate who will not stop. */
  | "hold"
  /** Bounds a goodbye that is produced but never spoken. */
  | "goodbye"
  /** Holds the room open for an answer to a question the sign-off asked. */
  | "closing"
  /** Tells the app the wrap-up line has been crossed. Steering only. */
  | "wrapUp";

export interface Timers {
  /** Start (or restart) one timer. */
  set(name: TimerName, ms: number, fire: () => void): void;
  /** Is this timer running? */
  has(name: TimerName): boolean;
  clear(name: TimerName): void;
  clearAll(): void;
}

export function createTimers(): Timers {
  const running = new Map<TimerName, ReturnType<typeof setTimeout>>();

  const clear = (name: TimerName) => {
    const timer = running.get(name);
    if (!timer) return;
    clearTimeout(timer);
    running.delete(name);
  };

  return {
    set(name, ms, fire) {
      clear(name);
      running.set(
        name,
        setTimeout(() => {
          // Forgotten before it fires, so a handler that re-arms the same timer
          // is arming a fresh one rather than fighting this entry.
          running.delete(name);
          fire();
        }, ms),
      );
    },

    has: (name) => running.has(name),
    clear,

    clearAll() {
      for (const timer of running.values()) clearTimeout(timer);
      running.clear();
    },
  };
}
