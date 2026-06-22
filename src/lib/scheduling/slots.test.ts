import { describe, it, expect } from "vitest";
import { generateSlots, zonedWallTimeToUtc } from "./slots";
import type { InterviewAvailabilityRule } from "@/lib/constants";

// Monday 09:00–11:00 (minutes from midnight). Jun 22 2026 is a Monday.
const mondayRule: InterviewAvailabilityRule = {
  weekday: 1,
  start_minute: 9 * 60,
  end_minute: 11 * 60,
};

describe("generateSlots", () => {
  it("expands a weekly rule into slot-length chunks in UTC", () => {
    const slots = generateSlots({
      rules: [mondayRule],
      slotMinutes: 60,
      timezone: "UTC",
      horizonDays: 7,
      now: new Date("2026-06-21T00:00:00.000Z"), // Sunday
    });

    expect(slots.map((s) => s.startIso)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-22T10:00:00.000Z",
    ]);
  });

  it("only emits slots that fully fit before the rule's end", () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, start_minute: 9 * 60, end_minute: 10 * 60 + 30 }], // 90 min window
      slotMinutes: 60,
      timezone: "UTC",
      horizonDays: 7,
      now: new Date("2026-06-21T00:00:00.000Z"),
    });

    // 9:00 fits (ends 10:00); 10:00 would end 11:00 > 10:30, so excluded.
    expect(slots.map((s) => s.startIso)).toEqual(["2026-06-22T09:00:00.000Z"]);
  });

  it("excludes past slots and those inside the lead time", () => {
    const slots = generateSlots({
      rules: [mondayRule],
      slotMinutes: 60,
      timezone: "UTC",
      horizonDays: 3, // next Monday is out of range
      now: new Date("2026-06-22T09:30:00.000Z"), // Monday mid-window
      leadMinutes: 60, // earliest bookable = 10:30
    });

    expect(slots).toEqual([]);
  });

  it("excludes already-booked slots", () => {
    const slots = generateSlots({
      rules: [mondayRule],
      slotMinutes: 60,
      timezone: "UTC",
      horizonDays: 7,
      now: new Date("2026-06-21T00:00:00.000Z"),
      bookedIso: ["2026-06-22T09:00:00.000Z"],
    });

    expect(slots.map((s) => s.startIso)).toEqual(["2026-06-22T10:00:00.000Z"]);
  });

  it("resolves wall-clock times correctly across a DST boundary", () => {
    // America/New_York springs forward on Sun Mar 8 2026; 09:00 local is EDT
    // (UTC-4) → 13:00 UTC, not 14:00 (EST).
    const slots = generateSlots({
      rules: [{ weekday: 0, start_minute: 9 * 60, end_minute: 10 * 60 }], // Sunday 09:00
      slotMinutes: 60,
      timezone: "America/New_York",
      horizonDays: 2,
      now: new Date("2026-03-07T00:00:00.000Z"),
    });

    expect(slots.map((s) => s.startIso)).toEqual(["2026-03-08T13:00:00.000Z"]);
  });

  it("returns nothing when there are no rules", () => {
    expect(
      generateSlots({ rules: [], slotMinutes: 60, timezone: "UTC", horizonDays: 7 }),
    ).toEqual([]);
  });
});

describe("zonedWallTimeToUtc", () => {
  it("maps a winter New York wall time to EST (UTC-5)", () => {
    // Jan 5 2026 09:00 EST → 14:00 UTC.
    expect(zonedWallTimeToUtc(2026, 1, 5, 9 * 60, "America/New_York").toISOString()).toBe(
      "2026-01-05T14:00:00.000Z",
    );
  });

  it("maps a summer New York wall time to EDT (UTC-4)", () => {
    // Jul 6 2026 09:00 EDT → 13:00 UTC.
    expect(zonedWallTimeToUtc(2026, 7, 6, 9 * 60, "America/New_York").toISOString()).toBe(
      "2026-07-06T13:00:00.000Z",
    );
  });
});
