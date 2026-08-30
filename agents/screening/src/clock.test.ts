import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnswerClock, type AnswerClockPacket } from "./clock.js";

afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  const sent: AnswerClockPacket[] = [];
  const clock = createAnswerClock({
    send: (packet) => sent.push(packet),
    heartbeatMs: 5_000,
    onInfo: () => {},
  });

  return { clock, sent };
}

describe("createAnswerClock", () => {
  /**
   * A deadline the product enforces is one the candidate is entitled to see:
   * the minute is only fair because they watch it fall for its whole length.
   */
  it("puts the number on screen immediately", () => {
    const { clock, sent } = harness();

    clock.set(60_000, false, "listening");

    expect(sent).toEqual([{ remainingMs: 60_000, expired: false, paused: false }]);
  });

  /**
   * A data packet is NOT buffered for anyone who is not in the room at the
   * moment it is sent, so one send per question loses the countdown outright
   * for a browser reconnecting after a blip or still finishing its join.
   * Re-sending heals reconnects, late joins and dropped packets with one
   * mechanism, and each repeat doubles as a drift correction.
   */
  it("re-sends while a clock is running, counting down as it goes", async () => {
    vi.useFakeTimers();
    const { clock, sent } = harness();

    clock.set(60_000, false, "listening");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sent).toHaveLength(3);
    expect(sent.at(-1)?.remainingMs).toBe(50_000);
  });

  /**
   * **A FROZEN clock re-sends the same number verbatim.** Letting elapsed time
   * reduce it would count the interviewer's own airtime against the candidate,
   * which is the whole thing freezing exists to prevent: the minute shown
   * standing still during a question is the minute they will actually get.
   */
  it("holds a paused number still, however long the interviewer talks", async () => {
    vi.useFakeTimers();
    const { clock, sent } = harness();

    clock.set(60_000, false, "asking q1", true);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(sent.every((packet) => packet.remainingMs === 60_000)).toBe(true);
    expect(sent.at(-1)?.paused).toBe(true);
  });

  /** Hiding the counter stops the re-sends with it, rather than leaking a timer. */
  it("stops re-sending once the counter is taken off screen", async () => {
    vi.useFakeTimers();
    const { clock, sent } = harness();
    clock.set(60_000, false, "listening");

    clock.set(null, false, "they answered");
    const afterHide = sent.length;
    await vi.advanceTimersByTimeAsync(20_000);

    expect(sent).toHaveLength(afterHide);
    expect(sent.at(-1)).toEqual({ remainingMs: null, expired: false, paused: false });
  });

  /**
   * Zero is left on the screen deliberately: it carries the only line that
   * explains what is about to happen, and it must not tick into a negative
   * number while the call moves on.
   */
  it("never counts past zero", async () => {
    vi.useFakeTimers();
    const { clock, sent } = harness();

    clock.set(3_000, false, "listening");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(sent.at(-1)?.remainingMs).toBe(0);
  });

  it("carries the expired flag through the re-sends", async () => {
    vi.useFakeTimers();
    const { clock, sent } = harness();

    clock.set(0, true, "their minute is up");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(sent.at(-1)).toEqual({ remainingMs: 0, expired: true, paused: false });
  });

  it("leaves no timer behind when the call ends", async () => {
    vi.useFakeTimers();
    const { clock, sent } = harness();
    clock.set(60_000, false, "listening");

    clock.stop();
    const afterStop = sent.length;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sent).toHaveLength(afterStop);
  });

  /**
   * A separate "wrapping up" countdown shipped and was removed the same day. It
   * appeared the instant the candidate stopped talking on the last question —
   * replacing "Your answer 1:00" with "Wrapping up 0:20" — and read as being
   * hurried off a call they had not finished.
   *
   * `paused` is the SAME counter standing still while the interviewer talks,
   * not a second clock counting down to something else. The list is pinned so a
   * third field has to argue for itself.
   */
  it("carries three fields and no wrap-up flag", () => {
    const { clock, sent } = harness();

    clock.set(60_000, false, "listening");

    expect(Object.keys(sent[0]!).sort()).toEqual(["expired", "paused", "remainingMs"]);
  });
});
