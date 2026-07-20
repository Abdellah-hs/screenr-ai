import { fetchBookedSlotIsos } from "@/lib/data/scheduling";
import { fetchOwnerSchedule } from "@/lib/scheduling/owner-schedule";
import {
  filterSlotsByBusy,
  generateBusinessHourWindows,
  generateSlotsFromWindows,
  padBusyBlocks,
  INTERVIEW_BUFFER_MINUTES,
  type GeneratedSlot,
} from "@/lib/scheduling/slots";

/**
 * The bookable interview slots for a campaign. A discriminated result so
 * callers map each outcome to their own control flow:
 *   - `calendar_unavailable` — strict gate: the owner's calendar couldn't be
 *     consulted, so NO slots are offered. `reason` is forwarded for logging.
 *   - `no_hours` — no bookable business-hours window falls in the horizon
 *     (only reachable for a degenerate horizon that spans a weekend only).
 *   - `ok` — the busy-filtered, buffered slots to offer / re-validate against.
 */
export type ResolvedSlots =
  | {
      status: "calendar_unavailable";
      reason: "not_connected" | "calendar_not_granted" | "lookup_failed";
    }
  | { status: "no_hours"; timezone: string }
  | { status: "ok"; timezone: string; slots: GeneratedSlot[] };

/**
 * Single source of truth for "what times are bookable" — a fixed 9am-6pm
 * weekday window minus the owner's buffered calendar conflicts and
 * already-booked slots. Availability is fully automatic: the owner no longer
 * marks "Interview hours" on their calendar; we synthesize the window and only
 * subtract their real busy time. Both the scheduling page (to display) and the
 * booking action (to re-validate the chosen slot) call this, so the two can
 * never drift. Runs candidate-side (admin client, gated upstream by a verified
 * token). The strict gate stands: if the calendar can't be read, offer nothing.
 */
export async function resolveAvailableSlots(ctx: {
  owner_user_id: string;
  booking_horizon_days: number;
  campaign_id: string;
  slot_minutes: number;
  timezone: string | null;
}): Promise<ResolvedSlots> {
  const schedule = await fetchOwnerSchedule({
    ownerUserId: ctx.owner_user_id,
    horizonDays: ctx.booking_horizon_days,
  });
  if (!schedule.available) {
    return { status: "calendar_unavailable", reason: schedule.reason };
  }

  // Slots are labeled in the calendar's own timezone; the campaign field is
  // only a fallback for the rare calendar that reports none.
  const timezone = schedule.timeZone ?? ctx.timezone ?? "UTC";

  // The bookable window is now synthesized (9am-6pm, weekdays) rather than read
  // from the calendar. Practically always non-empty; the guard only trips for a
  // degenerate horizon that lands entirely on a weekend.
  const windows = generateBusinessHourWindows({
    horizonDays: ctx.booking_horizon_days,
    timezone,
  });
  if (windows.length === 0) {
    return { status: "no_hours", timezone };
  }

  const bookedIso = await fetchBookedSlotIsos(ctx.campaign_id);
  const slots = filterSlotsByBusy(
    generateSlotsFromWindows({
      windows,
      slotMinutes: ctx.slot_minutes,
      timezone,
      bookedIso,
    }),
    ctx.slot_minutes,
    padBusyBlocks(schedule.conflicts, INTERVIEW_BUFFER_MINUTES),
  );

  return { status: "ok", timezone, slots };
}
