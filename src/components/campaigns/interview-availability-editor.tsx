"use client";

import { useState } from "react";
import { WEEKDAYS, type InterviewAvailabilityRule } from "@/lib/constants";

interface Props {
  initialRules?: InterviewAvailabilityRule[];
  initialSlotMinutes?: number | null;
  initialTimezone?: string | null;
  initialHorizonDays?: number;
}

const DEFAULT_RULE: InterviewAvailabilityRule = {
  weekday: 1, // Monday
  start_minute: 9 * 60, // 09:00
  end_minute: 17 * 60, // 17:00
};

/** minutes-from-midnight → "HH:MM" for an <input type="time">. */
function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → minutes-from-midnight (clamped to 0..1440). */
function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, Math.min(1440, h * 60 + m));
}

const inputClass =
  "w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors";

/**
 * Recruiter-facing editor for a campaign's AI-interview availability (PRD
 * 3.5.6). Weekly recurring time ranges + slot length, timezone, and booking
 * horizon. Serializes the weekly rules to a hidden `availability_rules_json`
 * field; the scalar settings post directly via named inputs. Mirrors
 * SlaTimersEditor's child-collection pattern.
 */
export default function InterviewAvailabilityEditor({
  initialRules = [],
  initialSlotMinutes = null,
  initialTimezone = null,
  initialHorizonDays = 14,
}: Props) {
  const [rules, setRules] = useState<InterviewAvailabilityRule[]>(initialRules);
  const [slotMinutes, setSlotMinutes] = useState<string>(
    initialSlotMinutes != null ? String(initialSlotMinutes) : "45",
  );
  const [timezone, setTimezone] = useState<string>(initialTimezone ?? "");
  const [horizonDays, setHorizonDays] = useState<string>(String(initialHorizonDays));

  const addRule = () => setRules([...rules, { ...DEFAULT_RULE }]);
  const removeRule = (index: number) => setRules(rules.filter((_, i) => i !== index));
  const updateRule = <K extends keyof InterviewAvailabilityRule>(
    index: number,
    field: K,
    value: InterviewAvailabilityRule[K],
  ) => {
    const next = [...rules];
    next[index] = { ...next[index], [field]: value };
    setRules(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#111827]">AI Interview Availability</h3>
        <button
          type="button"
          onClick={addRule}
          className="text-sm text-[#2563EB] hover:text-[#1D4ED8]"
        >
          + Add availability
        </button>
      </div>
      <p className="text-sm text-[#6B7280]">
        When candidates who pass screening can book the AI interview. Bookable slots are
        generated from these weekly hours.
      </p>

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
          <label className="block text-xs text-[#374151] mb-1">Timezone (IANA)</label>
          <input
            type="text"
            name="interview_timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. Africa/Casablanca"
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
            value={horizonDays}
            onChange={(e) => setHorizonDays(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="p-4 bg-gray-50 border border-gray-200 border-dashed rounded-lg text-center text-sm text-gray-500">
          No availability set — candidates won&apos;t be able to book an interview.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div
              key={index}
              className="p-4 bg-white border border-[#D1D5DB] rounded-lg relative group"
            >
              <button
                type="button"
                onClick={() => removeRule(index)}
                aria-label="Remove availability rule"
                className="absolute top-3 right-3 text-gray-400 hover:text-red-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="grid grid-cols-3 gap-4 pr-6">
                <div>
                  <label className="block text-xs text-[#374151] mb-1">Day</label>
                  <select
                    value={rule.weekday}
                    onChange={(e) => updateRule(index, "weekday", parseInt(e.target.value, 10))}
                    className={inputClass}
                  >
                    {WEEKDAYS.map((label, i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#374151] mb-1">Start</label>
                  <input
                    type="time"
                    value={minutesToTime(rule.start_minute)}
                    onChange={(e) => updateRule(index, "start_minute", timeToMinutes(e.target.value))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#374151] mb-1">End</label>
                  <input
                    type="time"
                    value={minutesToTime(rule.end_minute)}
                    onChange={(e) => updateRule(index, "end_minute", timeToMinutes(e.target.value))}
                    className={inputClass}
                  />
                </div>
              </div>
              {rule.end_minute <= rule.start_minute && (
                <p className="mt-2 text-xs text-red-600">End time must be after start time.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden input to pass the weekly rules to the Server Action. */}
      <input type="hidden" name="availability_rules_json" value={JSON.stringify(rules)} />
    </div>
  );
}
