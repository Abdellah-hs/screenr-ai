import { fetchBookedSlotIsos } from "@/lib/data/scheduling";
import { fetchOwnerSchedule } from "@/lib/scheduling/owner-schedule";
import {
  filterSlotsByBusy,
  generateSlotsFromWindows,
  padBusyBlocks,
  INTERVIEW_BUFFER_MINUTES,
  type GeneratedSlot,
} from "@/lib/scheduling/slots";

/**
 * The bookable interview slots for a campaign, resolved from the owner's live
 * Google Calendar. A discriminated result so callers map each outcome to their
 * own control flow:
 *   - `calendar_unavailable` — strict gate: the calendar couldn't be consulted,
 *     so NO slots are offered. `reason` is forwarded for the caller's log line.
 *   - `no_hours` — calendar read fine, but no "Interview hours" windows exist.
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
 * Single source of truth for "what times are bookable" — published calendar
 * hours minus buffered conflicts and already-booked slots. Both the scheduling
 * page (to display) and the booking action (to re-validate the chosen slot) call
 * this, so the two can never drift: the list shown is exactly the list the
 * server accepts. Runs candidate-side (admin client, gated upstream by a
 * verified token).
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

  // Calendar read fine, but the interviewer hasn't published hours blocks. Skip
  // the booked-slots read entirely on this (and the unavailable) path.
  if (schedule.windows.length === 0) {
    return { status: "no_hours", timezone };
  }

  const bookedIso = await fetchBookedSlotIsos(ctx.campaign_id);
  const slots = filterSlotsByBusy(
    generateSlotsFromWindows({
      windows: schedule.windows,
      slotMinutes: ctx.slot_minutes,
      timezone,
      bookedIso,
    }),
    ctx.slot_minutes,
    padBusyBlocks(schedule.conflicts, INTERVIEW_BUFFER_MINUTES),
  );

  return { status: "ok", timezone, slots };
}
