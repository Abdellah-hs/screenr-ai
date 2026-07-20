/** A single bookable AI-interview slot. */
export interface GeneratedSlot {
  /** UTC instant of the slot start, ISO string — the canonical identifier. */
  startIso: string;
  /** Calendar day in the campaign timezone, e.g. "2026-06-22" (for grouping). */
  dayKey: string;
  /** Human label in the campaign timezone, e.g. "Mon, Jun 22, 9:00 AM". */
  label: string;
}

/** The tz offset (ms) at `date`, such that localWallClock = utc + offset. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/**
 * The UTC instant for a wall-clock time on a calendar date in `timeZone`.
 * Two-pass to resolve DST boundaries (the offset can differ between the naive
 * guess and the resolved instant).
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(new Date(guessUtcMs), timeZone);
  let utcMs = guessUtcMs - offset1;
  const offset2 = tzOffsetMs(new Date(utcMs), timeZone);
  if (offset2 !== offset1) utcMs = guessUtcMs - offset2;
  return new Date(utcMs);
}

/** The calendar Y/M/D of `date` as seen in `timeZone`. */
function localYmd(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) };
}

/** A busy block (UTC instants) to subtract from the bookable slots. */
export interface BusyBlock {
  startIso: string;
  endIso: string;
}

/** 9:00 AM, in minutes from midnight — the default business-hours start. */
export const BUSINESS_HOURS_START_MINUTE = 9 * 60;
/** 6:00 PM, in minutes from midnight — the default business-hours end. */
export const BUSINESS_HOURS_END_MINUTE = 18 * 60;

export interface GenerateBusinessHourWindowsParams {
  /** How many days ahead candidates may book. */
  horizonDays: number;
  /** IANA timezone the business-hours window is expressed in. */
  timezone: string;
  /** "Now" — injectable for tests. Defaults to the current time. */
  now?: Date;
  /** Minutes-from-midnight the window opens. Defaults to 9am. */
  startMinute?: number;
  /** Minutes-from-midnight the window closes. Defaults to 6pm. */
  endMinute?: number;
}

/**
 * Synthesize one Mon-Fri business-hours window (9am-6pm by default) per
 * weekday across the booking horizon, in the given timezone — the automatic
 * replacement for the old calendar-marked "Interview hours" blocks; weekends
 * are skipped entirely. Feeds straight into `generateSlotsFromWindows`
 * exactly like a calendar-derived window would. Pure; `now` is injected.
 */
export function generateBusinessHourWindows(
  params: GenerateBusinessHourWindowsParams,
): BusyBlock[] {
  const {
    horizonDays,
    timezone,
    now = new Date(),
    startMinute = BUSINESS_HOURS_START_MINUTE,
    endMinute = BUSINESS_HOURS_END_MINUTE,
  } = params;

  const base = localYmd(now, timezone);
  const windows: BusyBlock[] = [];

  for (let i = 0; i <= horizonDays; i++) {
    // Walk calendar dates via UTC arithmetic on the local Y/M/D triple.
    const dayDate = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
    const y = dayDate.getUTCFullYear();
    const m = dayDate.getUTCMonth() + 1;
    const d = dayDate.getUTCDate();
    const weekday = dayDate.getUTCDay(); // 0=Sunday..6=Saturday

    if (weekday === 0 || weekday === 6) continue; // weekends closed

    windows.push({
      startIso: zonedWallTimeToUtc(y, m, d, startMinute, timezone).toISOString(),
      endIso: zonedWallTimeToUtc(y, m, d, endMinute, timezone).toISOString(),
    });
  }

  return windows;
}

/**
 * Breathing room enforced around the manager's existing meetings: a slot may
 * not start within this many minutes after a meeting ends, nor end within
 * this many minutes before one starts. Back-to-back interviews with other
 * calls read as rushed on both sides of the table.
 */
export const INTERVIEW_BUFFER_MINUTES = 15;

/**
 * Expand each busy block by `bufferMinutes` on both sides, so the existing
 * overlap filter (`filterSlotsByBusy`) automatically keeps slots clear of
 * meetings by that margin. Pure; blocks are not merged — overlap math doesn't
 * need them to be disjoint.
 */
export function padBusyBlocks(busy: BusyBlock[], bufferMinutes: number): BusyBlock[] {
  const padMs = bufferMinutes * 60_000;
  return busy.map((b) => ({
    startIso: new Date(new Date(b.startIso).getTime() - padMs).toISOString(),
    endIso: new Date(new Date(b.endIso).getTime() + padMs).toISOString(),
  }));
}

export interface GenerateSlotsFromWindowsParams {
  /** The manager's published "Interview hours" blocks (UTC instants). */
  windows: BusyBlock[];
  slotMinutes: number;
  /** IANA timezone used purely for the human labels / day grouping. */
  timezone: string;
  /** "Now" — injectable for tests. Defaults to the current time. */
  now?: Date;
  /** Already-booked slot start instants (ISO) to exclude. */
  bookedIso?: string[];
  /** Minimum notice before a slot can be booked. Defaults to 60 minutes. */
  leadMinutes?: number;
}

/**
 * Chop bookable windows (from `generateBusinessHourWindows`) into slots.
 * Overlapping/duplicate windows are merged first so a doubled-up window can't
 * produce misaligned or duplicate slots. Slots start at the (merged) window
 * start and step by `slotMinutes`; a trailing remainder shorter than a slot is
 * dropped. Exclusions: past / within-lead-time and already-booked starts.
 */
export function generateSlotsFromWindows(
  params: GenerateSlotsFromWindowsParams,
): GeneratedSlot[] {
  const {
    windows,
    slotMinutes,
    timezone,
    now = new Date(),
    bookedIso = [],
    leadMinutes = 60,
  } = params;

  if (windows.length === 0 || slotMinutes <= 0) return [];

  // Merge overlapping or touching windows into disjoint spans.
  const spans = windows
    .map((w) => ({ start: new Date(w.startIso).getTime(), end: new Date(w.endIso).getTime() }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const earliestMs = now.getTime() + leadMinutes * 60_000;
  const bookedMs = new Set(bookedIso.map((iso) => new Date(iso).getTime()));
  const slotMs = slotMinutes * 60_000;
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const slots: GeneratedSlot[] = [];
  for (const span of merged) {
    for (let ms = span.start; ms + slotMs <= span.end; ms += slotMs) {
      if (ms < earliestMs || bookedMs.has(ms)) continue;
      const start = new Date(ms);
      slots.push({
        startIso: start.toISOString(),
        dayKey: dayFmt.format(start),
        label: labelFmt.format(start),
      });
    }
  }

  slots.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return slots;
}

/**
 * The slot starts to highlight as "Recommended" on the booking page: the
 * earliest slot on each of the first `count` distinct days, so a candidate
 * gets quick choices spread across days instead of three back-to-back times.
 * When fewer days exist, the remaining picks are the next-earliest slots
 * overall. Input order is assumed sorted (both generators sort).
 */
export function pickRecommendedSlots(
  slots: GeneratedSlot[],
  count: number = 3,
): string[] {
  const picked = new Set<string>();
  const seenDays = new Set<string>();

  for (const slot of slots) {
    if (picked.size >= count) break;
    if (seenDays.has(slot.dayKey)) continue;
    seenDays.add(slot.dayKey);
    picked.add(slot.startIso);
  }

  for (const slot of slots) {
    if (picked.size >= count) break;
    picked.add(slot.startIso);
  }

  return [...picked];
}

/**
 * Drop every slot that overlaps one of the interviewer's calendar busy blocks.
 * Half-open interval math: slot [start, start+slotMinutes) vs busy
 * [start, end) — back-to-back is fine, so a meeting ending exactly when a slot
 * starts (or starting exactly when it ends) does NOT knock the slot out.
 * Unparseable or inverted blocks are ignored; a block we can't interpret must
 * not erase real availability. Pure.
 */
export function filterSlotsByBusy(
  slots: GeneratedSlot[],
  slotMinutes: number,
  busy: BusyBlock[],
): GeneratedSlot[] {
  const blocks = busy
    .map((b) => ({
      start: new Date(b.startIso).getTime(),
      end: new Date(b.endIso).getTime(),
    }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
  if (blocks.length === 0) return slots;

  const slotMs = slotMinutes * 60_000;
  return slots.filter((slot) => {
    const start = new Date(slot.startIso).getTime();
    const end = start + slotMs;
    return !blocks.some((b) => start < b.end && b.start < end);
  });
}
