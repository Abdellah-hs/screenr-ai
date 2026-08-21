"use client";

import { useRef } from "react";
import { EDITOR_TITLE, FIELD_SM, LABEL_SM } from "./editor-parts";

export interface AvailabilitySettings {
  slotMinutes: number;
  horizonDays: number;
}

interface Props {
  initialSlotMinutes?: number | null;
  initialTimezone?: string | null;
  initialHorizonDays?: number;
  /** Controlled mode — required by the wizard, whose steps unmount. */
  value?: AvailabilitySettings;
  /** Reports both knobs together so a caller can describe the booking window. */
  onChange?: (next: AvailabilitySettings) => void;
}

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
  value,
  onChange,
}: Props) {
  // Uncontrolled mode keeps the inputs uncontrolled — the form reads them
  // directly — so the last value of each is kept here purely to report the
  // pair together. Read only inside handlers, never during render.
  const slotRef = useRef(initialSlotMinutes ?? DEFAULT_SLOT_MINUTES);
  const horizonRef = useRef(initialHorizonDays);

  const controlled = value !== undefined;

  function reportSlot(slotMinutes: number) {
    slotRef.current = slotMinutes;
    onChange?.({ slotMinutes, horizonDays: value?.horizonDays ?? horizonRef.current });
  }

  function reportHorizon(horizonDays: number) {
    horizonRef.current = horizonDays;
    onChange?.({ slotMinutes: value?.slotMinutes ?? slotRef.current, horizonDays });
  }

  return (
    <div>
      <p className={`${EDITOR_TITLE} mb-3.5`}>Final interview availability</p>

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3.5">
        <svg
          className="mt-px h-[18px] w-[18px] shrink-0 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <div className="text-[13px] text-[#1E40AF]">
          <p className="mb-1 font-semibold">
            Availability is automatic — nothing to set up.
          </p>
          <p className="leading-[1.6]">
            Candidates book any <strong className="font-semibold">weekday 9am–6pm</strong>{" "}
            that&apos;s free on your Google Calendar, minus a 15-minute buffer either
            side. Keep the calendar current and the bookable times follow it — it
            needs your Google connection with calendar access (Settings →
            Integrations).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="interview_slot_minutes" className={LABEL_SM}>
            Slot length (minutes)
          </label>
          <input
            id="interview_slot_minutes"
            type="number"
            name="interview_slot_minutes"
            min={5}
            max={240}
            {...(controlled
              ? { value: value.slotMinutes }
              : { defaultValue: initialSlotMinutes ?? DEFAULT_SLOT_MINUTES })}
            onChange={(e) => reportSlot(Number(e.target.value) || DEFAULT_SLOT_MINUTES)}
            className={`${FIELD_SM} min-h-11 text-sm tabular-nums`}
          />
        </div>
        <div>
          <label htmlFor="interview_booking_horizon_days" className={LABEL_SM}>
            Booking horizon (days)
          </label>
          <input
            id="interview_booking_horizon_days"
            type="number"
            name="interview_booking_horizon_days"
            min={1}
            max={90}
            {...(controlled
              ? { value: value.horizonDays }
              : { defaultValue: initialHorizonDays })}
            onChange={(e) => reportHorizon(Number(e.target.value) || DEFAULT_HORIZON_DAYS)}
            className={`${FIELD_SM} min-h-11 text-sm tabular-nums`}
          />
        </div>
      </div>

      {/* Fallback timezone is auto-detected from the calendar; kept as a hidden
          field so an existing campaign's saved value isn't wiped on edit. */}
      <input type="hidden" name="interview_timezone" defaultValue={initialTimezone ?? ""} />
    </div>
  );
}
