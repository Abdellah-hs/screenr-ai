import { describe, it, expect } from "vitest";
import { createProctoringCollector, MAX_BUFFERED_EVENTS } from "./collector";

const T0 = Date.parse("2026-07-29T10:00:00.000Z");

describe("createProctoringCollector", () => {
  it("records nothing when no condition was ever opened", () => {
    const collector = createProctoringCollector();

    expect(collector.drain(T0)).toEqual([]);
  });

  it("turns an opened-then-closed condition into one timed event", () => {
    const collector = createProctoringCollector();

    collector.begin("tab_blur", T0);
    collector.end("tab_blur", T0 + 3_000);

    expect(collector.drain(T0 + 5_000)).toEqual([
      { type: "tab_blur", at: "2026-07-29T10:00:00.000Z", duration_ms: 3_000 },
    ]);
  });

  it("ignores a repeated begin so duplicate browser events don't restart the clock", () => {
    const collector = createProctoringCollector();

    collector.begin("tab_blur", T0);
    collector.begin("tab_blur", T0 + 2_000);
    collector.end("tab_blur", T0 + 6_000);

    const events = collector.drain(T0 + 6_000);
    expect(events).toHaveLength(1);
    expect(events[0].duration_ms).toBe(6_000);
  });

  it("ignores an end with no matching begin", () => {
    const collector = createProctoringCollector();

    collector.end("camera_off", T0 + 1_000);

    expect(collector.drain(T0 + 2_000)).toEqual([]);
  });

  it("closes a still-open condition at drain time", () => {
    const collector = createProctoringCollector();

    collector.begin("camera_off", T0);

    const events = collector.drain(T0 + 8_000);
    expect(events).toEqual([
      { type: "camera_off", at: "2026-07-29T10:00:00.000Z", duration_ms: 8_000 },
    ]);
  });

  it("tracks tab and camera conditions independently when they overlap", () => {
    const collector = createProctoringCollector();

    collector.begin("tab_blur", T0);
    collector.begin("camera_off", T0 + 1_000);
    collector.end("tab_blur", T0 + 4_000);
    collector.end("camera_off", T0 + 9_000);

    const events = collector.drain(T0 + 10_000);
    expect(events).toEqual([
      { type: "tab_blur", at: "2026-07-29T10:00:00.000Z", duration_ms: 4_000 },
      { type: "camera_off", at: "2026-07-29T10:00:01.000Z", duration_ms: 8_000 },
    ]);
  });

  it("empties the buffer after a drain so a restart begins clean", () => {
    const collector = createProctoringCollector();

    collector.begin("tab_blur", T0);
    collector.end("tab_blur", T0 + 2_000);
    collector.drain(T0 + 2_000);

    expect(collector.drain(T0 + 3_000)).toEqual([]);
  });

  it("stops buffering past the cap so a stuck event loop can't grow unbounded", () => {
    const collector = createProctoringCollector();

    for (let i = 0; i < MAX_BUFFERED_EVENTS + 25; i++) {
      collector.begin("tab_blur", T0 + i * 10);
      collector.end("tab_blur", T0 + i * 10 + 5);
    }

    expect(collector.drain(T0)).toHaveLength(MAX_BUFFERED_EVENTS);
  });

  it("clamps a backwards clock to zero instead of reporting a negative duration", () => {
    const collector = createProctoringCollector();

    collector.begin("tab_blur", T0);
    collector.end("tab_blur", T0 - 5_000);

    expect(collector.drain(T0)[0].duration_ms).toBe(0);
  });
});
