import { describe, it, expect } from "vitest";
import {
  filterSlotsByBusy,
  generateBusinessHourWindows,
  generateSlotsFromWindows,
  padBusyBlocks,
  pickRecommendedSlots,
  zonedWallTimeToUtc,
  type GeneratedSlot,
} from "./slots";

describe("generateBusinessHourWindows", () => {
  const SUNDAY = new Date("2026-06-21T00:00:00.000Z"); // Jun 22 2026 is a Monday.

  it("emits one 9am-6pm window for each weekday in the horizon, skipping weekends", () => {
    const windows = generateBusinessHourWindows({
      horizonDays: 6, // Sun 21 .. Sat 27 inclusive
      timezone: "UTC",
      now: SUNDAY,
    });

    expect(windows).toEqual([
      { startIso: "2026-06-22T09:00:00.000Z", endIso: "2026-06-22T18:00:00.000Z" },
      { startIso: "2026-06-23T09:00:00.000Z", endIso: "2026-06-23T18:00:00.000Z" },
      { startIso: "2026-06-24T09:00:00.000Z", endIso: "2026-06-24T18:00:00.000Z" },
      { startIso: "2026-06-25T09:00:00.000Z", endIso: "2026-06-25T18:00:00.000Z" },
      { startIso: "2026-06-26T09:00:00.000Z", endIso: "2026-06-26T18:00:00.000Z" },
    ]);
  });

  it("returns nothing when the horizon only spans a weekend", () => {
    const windows = generateBusinessHourWindows({
      horizonDays: 1, // Saturday + Sunday only
      timezone: "UTC",
      now: new Date("2026-06-27T00:00:00.000Z"), // Saturday
    });

    expect(windows).toEqual([]);
  });

  it("respects a custom start/end minute window", () => {
    const windows = generateBusinessHourWindows({
      horizonDays: 0,
      timezone: "UTC",
      now: new Date("2026-06-22T00:00:00.000Z"), // Monday
      startMinute: 8 * 60,
      endMinute: 16 * 60,
    });

    expect(windows).toEqual([
      { startIso: "2026-06-22T08:00:00.000Z", endIso: "2026-06-22T16:00:00.000Z" },
    ]);
  });

  it("resolves wall-clock times correctly across a DST boundary", () => {
    // America/New_York springs forward on Sun Mar 8 2026; Monday Mar 9 09:00
    // local is EDT (UTC-4) → 13:00 UTC, not 14:00 (EST). `now` is deliberately
    // mid-morning UTC on Mar 9, not midnight — at UTC midnight, New York local
    // time is still ~8pm Mar 8 (Sunday), which would misclassify the day.
    const windows = generateBusinessHourWindows({
      horizonDays: 0,
      timezone: "America/New_York",
      now: new Date("2026-03-09T12:00:00.000Z"), // 8am EDT, safely Monday locally
    });

    expect(windows).toEqual([
      { startIso: "2026-03-09T13:00:00.000Z", endIso: "2026-03-09T22:00:00.000Z" },
    ]);
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

describe("filterSlotsByBusy", () => {
  // One-hour slots at 09:00, 10:00, 11:00 UTC on Jun 22 2026.
  function slot(hour: number): GeneratedSlot {
    const startIso = `2026-06-22T${String(hour).padStart(2, "0")}:00:00.000Z`;
    return { startIso, dayKey: "2026-06-22", label: `Mon, Jun 22, ${hour}:00` };
  }
  const slots = [slot(9), slot(10), slot(11)];

  it("removes a slot fully covered by a busy block", () => {
    const busy = [{ startIso: "2026-06-22T10:00:00.000Z", endIso: "2026-06-22T11:00:00.000Z" }];

    const kept = filterSlotsByBusy(slots, 60, busy);

    expect(kept.map((s) => s.startIso)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-22T11:00:00.000Z",
    ]);
  });

  it("removes a slot when a meeting overlaps only its tail", () => {
    // Meeting 09:30–09:45 sits inside the 09:00–10:00 slot.
    const busy = [{ startIso: "2026-06-22T09:30:00.000Z", endIso: "2026-06-22T09:45:00.000Z" }];

    const kept = filterSlotsByBusy(slots, 60, busy);

    expect(kept.map((s) => s.startIso)).toEqual([
      "2026-06-22T10:00:00.000Z",
      "2026-06-22T11:00:00.000Z",
    ]);
  });

  it("removes every slot a long meeting spans", () => {
    // Meeting 09:30–11:30 clips slots 09:00, 10:00 and 11:00.
    const busy = [{ startIso: "2026-06-22T09:30:00.000Z", endIso: "2026-06-22T11:30:00.000Z" }];

    expect(filterSlotsByBusy(slots, 60, busy)).toEqual([]);
  });

  it("keeps back-to-back slots: busy ending exactly at a slot start does not block it", () => {
    const busy = [{ startIso: "2026-06-22T08:00:00.000Z", endIso: "2026-06-22T09:00:00.000Z" }];

    expect(filterSlotsByBusy(slots, 60, busy)).toEqual(slots);
  });

  it("keeps back-to-back slots: busy starting exactly at a slot end does not block it", () => {
    const busy = [{ startIso: "2026-06-22T12:00:00.000Z", endIso: "2026-06-22T13:00:00.000Z" }];

    expect(filterSlotsByBusy(slots, 60, busy)).toEqual(slots);
  });

  it("returns all slots when the calendar window is free", () => {
    expect(filterSlotsByBusy(slots, 60, [])).toEqual(slots);
  });

  it("ignores unparseable or inverted busy blocks instead of erasing availability", () => {
    const busy = [
      { startIso: "not-a-date", endIso: "2026-06-22T10:00:00.000Z" },
      { startIso: "2026-06-22T11:00:00.000Z", endIso: "2026-06-22T10:00:00.000Z" }, // inverted
    ];

    expect(filterSlotsByBusy(slots, 60, busy)).toEqual(slots);
  });

  it("respects the slot length when deciding overlap", () => {
    // 30-minute slot at 09:00 ends 09:30; a 09:30–10:00 meeting doesn't touch it.
    const busy = [{ startIso: "2026-06-22T09:30:00.000Z", endIso: "2026-06-22T10:00:00.000Z" }];

    const kept = filterSlotsByBusy([slot(9)], 30, busy);

    expect(kept.map((s) => s.startIso)).toEqual(["2026-06-22T09:00:00.000Z"]);
  });
});

describe("padBusyBlocks", () => {
  it("expands every block by the buffer on both sides", () => {
    const busy = [{ startIso: "2026-06-22T10:00:00.000Z", endIso: "2026-06-22T10:30:00.000Z" }];

    expect(padBusyBlocks(busy, 15)).toEqual([
      { startIso: "2026-06-22T09:45:00.000Z", endIso: "2026-06-22T10:45:00.000Z" },
    ]);
  });

  it("leaves blocks untouched with a zero buffer", () => {
    const busy = [{ startIso: "2026-06-22T10:00:00.000Z", endIso: "2026-06-22T10:30:00.000Z" }];

    expect(padBusyBlocks(busy, 0)).toEqual(busy);
  });

  it("combined with the overlap filter, keeps meetings at arm's length from slots", () => {
    // 10:00–10:30 meeting + 15-min buffer occupies 09:45–10:45: the 9:00 slot
    // (ends 10:00) now collides at 09:45, and 11:00 is the next clean start.
    const slots: GeneratedSlot[] = [9, 10, 11].map((h) => ({
      startIso: `2026-06-22T${String(h).padStart(2, "0")}:00:00.000Z`,
      dayKey: "2026-06-22",
      label: `${h}:00`,
    }));
    const busy = [{ startIso: "2026-06-22T10:00:00.000Z", endIso: "2026-06-22T10:30:00.000Z" }];

    const kept = filterSlotsByBusy(slots, 60, padBusyBlocks(busy, 15));

    expect(kept.map((s) => s.startIso)).toEqual(["2026-06-22T11:00:00.000Z"]);
  });
});

describe("generateSlotsFromWindows", () => {
  const NOW = new Date("2026-06-21T00:00:00.000Z");

  it("chops a published window into slot-length chunks", () => {
    const slots = generateSlotsFromWindows({
      windows: [{ startIso: "2026-06-22T09:00:00.000Z", endIso: "2026-06-22T11:00:00.000Z" }],
      slotMinutes: 60,
      timezone: "UTC",
      now: NOW,
    });

    expect(slots.map((s) => s.startIso)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-22T10:00:00.000Z",
    ]);
  });

  it("drops a trailing remainder shorter than a slot", () => {
    const slots = generateSlotsFromWindows({
      windows: [{ startIso: "2026-06-22T09:00:00.000Z", endIso: "2026-06-22T10:30:00.000Z" }],
      slotMinutes: 60,
      timezone: "UTC",
      now: NOW,
    });

    expect(slots.map((s) => s.startIso)).toEqual(["2026-06-22T09:00:00.000Z"]);
  });

  it("merges overlapping windows so slots stay aligned and unique", () => {
    // 09:00–10:30 and 10:00–12:00 merge into 09:00–12:00 → three clean slots.
    const slots = generateSlotsFromWindows({
      windows: [
        { startIso: "2026-06-22T09:00:00.000Z", endIso: "2026-06-22T10:30:00.000Z" },
        { startIso: "2026-06-22T10:00:00.000Z", endIso: "2026-06-22T12:00:00.000Z" },
      ],
      slotMinutes: 60,
      timezone: "UTC",
      now: NOW,
    });

    expect(slots.map((s) => s.startIso)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-22T10:00:00.000Z",
      "2026-06-22T11:00:00.000Z",
    ]);
  });

  it("excludes slots inside the lead time and already-booked starts", () => {
    const slots = generateSlotsFromWindows({
      windows: [{ startIso: "2026-06-22T09:00:00.000Z", endIso: "2026-06-22T12:00:00.000Z" }],
      slotMinutes: 60,
      timezone: "UTC",
      now: new Date("2026-06-22T08:30:00.000Z"), // lead 60min → earliest 09:30
      bookedIso: ["2026-06-22T10:00:00.000Z"],
    });

    expect(slots.map((s) => s.startIso)).toEqual(["2026-06-22T11:00:00.000Z"]);
  });

  it("labels slots in the requested timezone", () => {
    // 13:00 UTC on Jan 5 2026 is 8:00 AM in New York (EST).
    const slots = generateSlotsFromWindows({
      windows: [{ startIso: "2026-01-05T13:00:00.000Z", endIso: "2026-01-05T14:00:00.000Z" }],
      slotMinutes: 60,
      timezone: "America/New_York",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].dayKey).toBe("2026-01-05");
    expect(slots[0].label).toContain("8:00");
  });

  it("returns nothing for no windows or malformed windows", () => {
    expect(
      generateSlotsFromWindows({ windows: [], slotMinutes: 60, timezone: "UTC", now: NOW }),
    ).toEqual([]);
    expect(
      generateSlotsFromWindows({
        windows: [{ startIso: "2026-06-22T11:00:00.000Z", endIso: "2026-06-22T09:00:00.000Z" }],
        slotMinutes: 60,
        timezone: "UTC",
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("pickRecommendedSlots", () => {
  function slotAt(day: number, hour: number): GeneratedSlot {
    const dd = String(day).padStart(2, "0");
    const hh = String(hour).padStart(2, "0");
    return {
      startIso: `2026-06-${dd}T${hh}:00:00.000Z`,
      dayKey: `2026-06-${dd}`,
      label: `Jun ${day}, ${hour}:00`,
    };
  }

  it("picks the earliest slot on each of the first three distinct days", () => {
    const slots = [
      slotAt(22, 9),
      slotAt(22, 10),
      slotAt(23, 9),
      slotAt(24, 14),
      slotAt(25, 9),
    ];

    expect(pickRecommendedSlots(slots)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-23T09:00:00.000Z",
      "2026-06-24T14:00:00.000Z",
    ]);
  });

  it("fills from the next-earliest slots when fewer distinct days exist", () => {
    const slots = [slotAt(22, 9), slotAt(22, 10), slotAt(22, 11), slotAt(23, 9)];

    expect(pickRecommendedSlots(slots)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-23T09:00:00.000Z",
      "2026-06-22T10:00:00.000Z",
    ]);
  });

  it("returns every slot when fewer exist than the requested count", () => {
    const slots = [slotAt(22, 9), slotAt(23, 9)];

    expect(pickRecommendedSlots(slots)).toEqual([
      "2026-06-22T09:00:00.000Z",
      "2026-06-23T09:00:00.000Z",
    ]);
  });

  it("returns nothing for an empty slot list", () => {
    expect(pickRecommendedSlots([])).toEqual([]);
  });
});
