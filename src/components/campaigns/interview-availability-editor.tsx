"use client";

interface Props {
  initialSlotMinutes?: number | null;
  initialTimezone?: string | null;
  initialHorizonDays?: number;
}

const inputClass =
  "w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors";

// Default for a campaign that hasn't set a slot length (create form / legacy rows).
const DEFAULT_SLOT_MINUTES = 45;
const DEFAULT_HORIZON_DAYS = 14;

/**
 * Recruiter-facing settings for final-interview slot booking. Availability
 * itself is fully automatic — every weekday 9am-6pm is offered, minus the
 * owner's real Google Calendar conflicts, with a 15-minute buffer (see
 * `generateBusinessHourWindows` / `fetchOwnerSchedule`). The recruiter marks
 * nothing on their calendar.
 *
 * Two knobs stay configurable: slot length and booking horizon. The fallback
 * timezone is auto-detected from the calendar, so it's no longer shown — it
 * rides along as a hidden field to preserve any value an existing campaign saved.
 */
export default function InterviewAvailabilityEditor({
  initialSlotMinutes = null,
  initialTimezone = null,
  initialHorizonDays = DEFAULT_HORIZON_DAYS,
}: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-[#111827]">Final Interview Availability</h3>

      <div className="flex items-start gap-3 rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] p-4">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-[#0369A1]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <div className="text-sm text-[#0C4A6E]">
          <p className="font-medium">Availability is automatic — nothing to set up.</p>
          <p className="mt-1 text-[#075985]">
            Candidates can book any <strong>weekday between 9am and 6pm</strong> that&apos;s
            free on your Google Calendar, minus your existing meetings with a 15-minute
            buffer on each side. Just keep your calendar up to date — the bookable times
            follow it. Requires your Google connection with calendar access
            (Settings → Integrations).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[#374151] mb-1">Slot length (minutes)</label>
          <input
            type="number"
            name="interview_slot_minutes"
            min="5"
            max="240"
            defaultValue={initialSlotMinutes ?? DEFAULT_SLOT_MINUTES}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-[#374151] mb-1">Booking horizon (days)</label>
          <input
            type="number"
            name="interview_booking_horizon_days"
            min="1"
            max="90"
            defaultValue={initialHorizonDays}
            className={inputClass}
          />
        </div>
      </div>

      {/* Fallback timezone is auto-detected from the calendar; kept as a hidden
          field so an existing campaign's saved value isn't wiped on edit. */}
      <input type="hidden" name="interview_timezone" defaultValue={initialTimezone ?? ""} />
    </div>
  );
}
