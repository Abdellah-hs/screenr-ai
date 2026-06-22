"use client";

import { useMemo, useState, useTransition } from "react";
import { bookInterviewSlot } from "@/lib/actions/schedule";
import type { GeneratedSlot } from "@/lib/scheduling/slots";

interface Props {
  token: string;
  campaignTitle: string;
  timezone: string;
  slots: GeneratedSlot[];
}

/**
 * Candidate-facing AI-interview scheduler (PRD 3.5.6). Slots are grouped by day
 * and shown in the campaign timezone; selecting one and confirming books it via
 * the token-gated server action. Mobile-friendly tap targets (PRD 3.9.3).
 */
export default function InterviewScheduler({ token, campaignTitle, timezone, slots }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startBooking] = useTransition();

  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "short", day: "numeric" }),
    [timezone],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }),
    [timezone],
  );

  const groups = useMemo(() => {
    const map = new Map<string, GeneratedSlot[]>();
    for (const slot of slots) {
      const list = map.get(slot.dayKey) ?? [];
      list.push(slot);
      map.set(slot.dayKey, list);
    }
    return [...map.values()];
  }, [slots]);

  function confirm() {
    if (!selected) return;
    setError(null);
    startBooking(async () => {
      try {
        await bookInterviewSlot({ token, start_iso: selected });
        setDone(selected);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't book that slot. Please try again.");
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[#111827]">Interview scheduled</h2>
        <p className="text-sm text-[#6B7280]">
          You&apos;re booked for <strong>{dayFmt.format(new Date(done))}</strong> at{" "}
          <strong>{timeFmt.format(new Date(done))}</strong> ({timezone}). We&apos;ve emailed you a
          confirmation for <strong>{campaignTitle}</strong>.
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 text-center">
        <p className="text-sm text-[#6B7280]">
          There are no interview times available right now. Please check back later or contact the
          hiring team.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5">
      <p className="text-sm text-[#6B7280]">
        Pick a time for your <strong>{campaignTitle}</strong> interview. Times are shown in{" "}
        <strong>{timezone}</strong>.
      </p>

      <div className="space-y-5">
        {groups.map((daySlots) => (
          <div key={daySlots[0].dayKey}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#0369A1]">
              {dayFmt.format(new Date(daySlots[0].startIso))}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {daySlots.map((slot) => {
                const isSelected = selected === slot.startIso;
                return (
                  <button
                    key={slot.startIso}
                    type="button"
                    onClick={() => setSelected(slot.startIso)}
                    aria-pressed={isSelected}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      isSelected
                        ? "border-[#0369A1] bg-[#0369A1] text-white"
                        : "border-[#BAE6FD] bg-[#F0F9FF] text-[#0369A1] hover:bg-[#E0F2FE]"
                    }`}
                  >
                    {timeFmt.format(new Date(slot.startIso))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={confirm}
        disabled={!selected || pending}
        className="w-full rounded-lg bg-[#0369A1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0C4A6E] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {pending ? "Booking…" : "Confirm interview time"}
      </button>
    </div>
  );
}
