import { afterEach, describe, expect, it, vi } from "vitest";
import { createTimers } from "./timers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createTimers", () => {
  /**
   * These were five loose `let` bindings with four near-identical clear
   * helpers. The bug that shape invites is a timer cleared on one path and left
   * running on another — which on this worker means a watchdog firing into a
   * question that is already being asked.
   */
  it("fires one event and forgets the timer", async () => {
    vi.useFakeTimers();
    const timers = createTimers();
    let fired = 0;

    timers.set("listen", 1_000, () => (fired += 1));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fired).toBe(1);
    // Forgotten before it fires, so a handler that re-arms the same timer is
    // arming a fresh one rather than fighting this entry.
    expect(timers.has("listen")).toBe(false);
  });

  /**
   * Re-arming is how a held answer's window is extended by the next fragment.
   * The old timer must not also fire, or one answer settles twice.
   */
  it("replaces a running timer rather than adding a second", async () => {
    vi.useFakeTimers();
    const timers = createTimers();
    const fired: string[] = [];

    timers.set("settle", 3_000, () => fired.push("first"));
    await vi.advanceTimersByTimeAsync(1_000);
    timers.set("settle", 3_000, () => fired.push("second"));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(fired).toEqual(["second"]);
  });

  it("says whether a timer is running, which is how a hold is armed only once", async () => {
    vi.useFakeTimers();
    const timers = createTimers();

    expect(timers.has("hold")).toBe(false);
    timers.set("hold", 10_000, () => {});
    expect(timers.has("hold")).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(timers.has("hold")).toBe(false);
  });

  it("cancels a timer that has not fired", async () => {
    vi.useFakeTimers();
    const timers = createTimers();
    let fired = false;

    timers.set("listen", 1_000, () => (fired = true));
    timers.clear("listen");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fired).toBe(false);
  });

  /**
   * The ending clears everything at once. A timer surviving the goodbye fires
   * into a call that is closing, where at best it is ignored and at worst it
   * asks something.
   */
  it("cancels every timer at once", async () => {
    vi.useFakeTimers();
    const timers = createTimers();
    const fired: string[] = [];

    timers.set("listen", 1_000, () => fired.push("listen"));
    timers.set("settle", 2_000, () => fired.push("settle"));
    timers.set("wrapUp", 3_000, () => fired.push("wrapUp"));

    timers.clearAll();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fired).toEqual([]);
  });

  it("is unbothered by clearing something that is not running", () => {
    const timers = createTimers();

    expect(() => {
      timers.clear("goodbye");
      timers.clearAll();
    }).not.toThrow();
  });
});
