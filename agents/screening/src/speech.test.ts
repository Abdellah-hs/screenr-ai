import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpeaker } from "./speech.js";

afterEach(() => {
  vi.useRealTimers();
});

function harness(
  over: {
    generateReply?: (instructions: string) => PromiseLike<unknown>;
    isClosed?: () => boolean;
  } = {},
) {
  const spoken: string[] = [];
  const ended: string[] = [];

  const speaker = createSpeaker({
    generateReply:
      over.generateReply ??
      (async (instructions) => {
        spoken.push(instructions);
      }),
    backstopMs: 45_000,
    isClosed: over.isClosed ?? (() => false),
    onInfo: () => {},
    onError: () => {},
  });

  return { speaker, spoken, ended };
}

describe("createSpeaker", () => {
  it("says what it is given and reports the turn ending", async () => {
    const { speaker, spoken, ended } = harness();

    speaker.speak("Ask about Kafka.", "q1", () => ended.push("q1"));
    await speaker.drain();

    expect(spoken).toEqual(["Ask about Kafka."]);
    expect(ended).toEqual(["q1"]);
  });

  /**
   * There is one room and one voice, so there is one lane. Two speaking turns
   * cannot legally overlap under the state machine, but a backend error landing
   * mid-greeting is a genuine overlap — this is what makes it queue rather than
   * collide.
   */
  it("speaks one turn at a time", async () => {
    const order: string[] = [];
    const { speaker } = harness({
      generateReply: async (instructions) => {
        order.push(`start:${instructions}`);
        await new Promise((r) => setTimeout(r, 0));
        order.push(`end:${instructions}`);
      },
    });

    speaker.speak("first", "a", () => {});
    speaker.speak("second", "b", () => {});
    await speaker.drain();

    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  /**
   * **A turn that ended in no event at all is a room nobody will drive again**,
   * which is the one failure `create_response: false` introduces. Whether the
   * reply was said, cut off, or threw, the machine has to be told.
   */
  it("still ends the turn when the reply throws", async () => {
    const ended: string[] = [];
    const { speaker } = harness({
      generateReply: () => Promise.reject(new Error("session gone")),
    });

    speaker.speak("anything", "q1", () => ended.push("q1"));
    await speaker.drain();

    expect(ended).toEqual(["q1"]);
  });

  /**
   * `generateReply` resolving on playout is what makes the loop readable as a
   * conversation, and it is also what makes a hang fatal: the lane is
   * single-file, so a reply that never completes stops every later turn, every
   * answer timeout, and the watchdog that was supposed to save the call.
   */
  it("gives up on a reply that never completes, and moves the call on", async () => {
    vi.useFakeTimers();
    const ended: string[] = [];
    const { speaker } = harness({ generateReply: () => new Promise(() => {}) });

    speaker.speak("anything", "q1", () => ended.push("q1"));
    await vi.advanceTimersByTimeAsync(45_000);

    expect(ended).toEqual(["q1"]);
  });

  /**
   * Two things observe a turn ending and either may be first: the session's own
   * state change leaving "speaking", and the reply resolving on playout. Both
   * end the turn; the second must be a no-op, because a doubled ending would
   * skip the re-delivery a candidate who talked over the sign-off is owed.
   */
  it("ends a turn exactly once, however many observers notice", async () => {
    const ended: string[] = [];
    const { speaker } = harness({
      generateReply: async () => {
        // The session notices the turn ending first.
        speaker.endCurrentTurn();
      },
    });

    speaker.speak("anything", "goodbye", () => ended.push("goodbye"));
    await speaker.drain();
    speaker.endCurrentTurn();

    expect(ended).toEqual(["goodbye"]);
  });

  /** Nothing is owed once the room has gone, but the machine still has to be told. */
  it("drops a queued turn once the room has closed, without stranding the machine", async () => {
    const ended: string[] = [];
    const { speaker, spoken } = harness({ isClosed: () => true });

    speaker.speak("anything", "q1", () => ended.push("q1"));
    await speaker.drain();

    expect(spoken).toEqual([]);
    expect(ended).toEqual(["q1"]);
  });

  it("keeps the lane usable after a turn has failed", async () => {
    let attempt = 0;
    const spoken: string[] = [];
    const { speaker } = harness({
      generateReply: async (instructions) => {
        attempt += 1;
        if (attempt === 1) throw new Error("cancelled");
        spoken.push(instructions);
      },
    });

    speaker.speak("first", "a", () => {});
    speaker.speak("second", "b", () => {});
    await speaker.drain();

    expect(spoken).toEqual(["second"]);
  });
});
