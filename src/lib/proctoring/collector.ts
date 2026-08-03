import type { ProctoringEvent, ProctoringIncidentType } from "./incidents";

/**
 * Client-side buffer for proctoring observations during a live interview.
 *
 * Browser proctoring signals are *conditions with a duration*, not instants:
 * the candidate leaves the tab and comes back, the camera drops and recovers.
 * This collects those open/close pairs into timed `ProctoringEvent`s that the
 * component flushes once, on submit.
 *
 * Deliberately DOM-free and clock-free — every method takes the timestamp — so
 * the interval bookkeeping is unit-testable without faking browser events. The
 * component owns listener wiring; this owns the arithmetic.
 *
 * Nothing here judges severity: it reports what happened and for how long, and
 * the server (`summarizeProctoring`) decides what that's worth.
 */

/**
 * Hard ceiling on buffered events, matching the server's Zod bound. Past it we
 * stop recording rather than grow without limit — a browser stuck flapping
 * focus events shouldn't be able to balloon the submit payload.
 */
export const MAX_BUFFERED_EVENTS = 200;

export interface ProctoringCollector {
  /** Note that a condition started (no-op if it's already open). */
  begin(type: ProctoringIncidentType, atMs: number): void;
  /** Note that a condition ended (no-op if it was never open). */
  end(type: ProctoringIncidentType, atMs: number): void;
  /** Close anything still open, return every buffered event, and reset. */
  drain(atMs: number): ProctoringEvent[];
}

export function createProctoringCollector(): ProctoringCollector {
  const openedAt = new Map<ProctoringIncidentType, number>();
  let events: ProctoringEvent[] = [];

  function close(type: ProctoringIncidentType, atMs: number): void {
    const startedAt = openedAt.get(type);
    if (startedAt === undefined) return;
    openedAt.delete(type);
    if (events.length >= MAX_BUFFERED_EVENTS) return;
    events.push({
      type,
      at: new Date(startedAt).toISOString(),
      // A backwards clock (system time change mid-call) must not produce a
      // negative duration the server would reject.
      duration_ms: Math.max(0, atMs - startedAt),
    });
  }

  return {
    begin(type, atMs) {
      if (openedAt.has(type)) return;
      openedAt.set(type, atMs);
    },

    end(type, atMs) {
      close(type, atMs);
    },

    drain(atMs) {
      for (const type of [...openedAt.keys()]) close(type, atMs);
      const drained = events;
      events = [];
      return drained;
    },
  };
}
