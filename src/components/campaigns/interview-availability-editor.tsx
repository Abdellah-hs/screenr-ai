"use client";

import { useState } from "react";

interface Props {
  initialSlotMinutes?: number | null;
  initialTimezone?: string | null;
  initialHorizonDays?: number;
}

const inputClass =
  "w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors";

/**
 * Recruiter-facing settings for final-interview slot booking. Availability
 * itself is NOT configured here — it's fully automatic: every weekday 9am-6pm
 * is offered, minus the owner's real Google Calendar conflicts, with a
 * 15-minute buffer (see `generateBusinessHourWindows` / `fetchOwnerSchedule`).
 * The recruiter marks nothing on their calendar. This form only keeps the
 * scalar knobs: slot length, booking horizon, and a fallback timezone.
 */
export default function InterviewAvailabilityEditor({
  initialSlotMinutes = null,
  initialTimezone = null,
  initialHorizonDays = 14,
}: Props) {
  const [slotMinutes, setSlotMinutes] = useState<string>(
    initialSlotMinutes != null ? String(initialSlotMinutes) : "45",
  );
  const [timezone, setTimezone] = useState<string>(initialTimezone ?? "");
  const [horizonDays, setHorizonDays] = useState<string>(String(initialHorizonDays));

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-[#374151] mb-1">Slot length (minutes)</label>
          <input
            type="number"
            name="interview_slot_minutes"
            min="5"
            max="240"
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-[#374151] mb-1">Fallback timezone (IANA)</label>
          <input
            type="text"
            name="interview_timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. Africa/Casablanca"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Usually auto-detected from your calendar — used only if Google doesn&apos;t
            report one.
          </p>
        </div>
        <div>
          <label className="block text-xs text-[#374151] mb-1">Booking horizon (days)</label>
          <input
            type="number"
            name="interview_booking_horizon_days"
            min="1"
            max="90"
            value={horizonDays}
            onChange={(e) => setHorizonDays(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
