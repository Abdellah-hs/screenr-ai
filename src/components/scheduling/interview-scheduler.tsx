"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { bookInterviewSlot, confirmRescheduledSlot } from "@/lib/actions/schedule";
import type { GeneratedSlot } from "@/lib/scheduling/slots";

/** "book" = first-time pick; "reschedule" = re-pick after the recruiter moved it. */
export type SchedulerMode = "book" | "reschedule";

interface Props {
  token: string;
  campaignTitle: string;
  timezone: string;
  slots: GeneratedSlot[];
  /** Slot starts (ISO) the server suggests first — rendered as quick picks. */
  recommendedIso?: string[];
  mode?: SchedulerMode;
}

/**
 * Candidate-facing final-interview scheduler. Slots are the interviewer's
 * automatic weekday business hours minus their real conflicts, grouped by day
 * and shown in the interviewer's timezone; selecting one and confirming books
 * it via the token-gated server action. In "reschedule" mode (the recruiter
 * moved the time) the same grid re-confirms a new slot instead. Mobile-friendly
 * tap targets (PRD 3.9.3).
 */
/** The zone never changes under us, so there is nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

function readBrowserZone(): string | null {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}

function readZoneOnServer(): string | null {
  return null;
}

export default function InterviewScheduler({
  token,
  campaignTitle,
  timezone,
  slots,
  recommendedIso = [],
  mode = "book",
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startBooking] = useTransition();

  const isReschedule = mode === "reschedule";

  /**
   * The candidate's own timezone, once the browser can tell us.
   *
   * Resolved after mount rather than at render: on the server `Intl` reports
   * the *server's* zone, so using it directly would render one set of times and
   * hydrate into another. Null until known — and null forever when it matches
   * the interviewer's, in which case there is nothing to convert and no control
   * worth showing.
   */
  const [showTheirs, setShowTheirs] = useState(false);

  const browserZone = useSyncExternalStore(
    subscribeNever,
    readBrowserZone,
    // The server has no idea where the reader is, and guessing is what produces
    // a hydration mismatch across every time on the page.
    readZoneOnServer,
  );
  const viewerZone = browserZone && browserZone !== timezone ? browserZone : null;

  // Their zone until we know the candidate's, then the candidate's — a slot
  // list is useless in a timezone the reader has to convert out of in their
  // head, and getting it wrong costs them the interview.
  const activeZone = viewerZone && !showTheirs ? viewerZone : timezone;

  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: activeZone, weekday: "long", month: "short", day: "numeric" }),
    [activeZone],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: activeZone, hour: "numeric", minute: "2-digit" }),
    [activeZone],
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

  // Resolve the server's recommended picks against the offered slots — a
  // recommendation that no longer exists (raced away) is silently dropped.
  const recommended = useMemo(
    () =>
      recommendedIso
        .map((iso) => slots.find((s) => s.startIso === iso))
        .filter((s): s is GeneratedSlot => Boolean(s)),
    [recommendedIso, slots],
  );

  function confirm() {
    if (!selected) return;
    setError(null);
    startBooking(async () => {
      try {
        if (isReschedule) {
          await confirmRescheduledSlot({ token, start_iso: selected });
        } else {
          await bookInterviewSlot({ token, start_iso: selected });
        }
        setDone(selected);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't book that slot. Please try again.");
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/40">
          <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-[#111827]">You&apos;re all set</h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-[#6B7280]">
          Your <strong className="font-medium text-[#374151]">{campaignTitle}</strong> interview is
          {isReschedule ? " now" : " booked for"}{" "}
          <strong className="font-medium text-[#111827]">{dayFmt.format(new Date(done))}</strong> at{" "}
          <strong className="font-medium text-[#111827]">{timeFmt.format(new Date(done))}</strong>.
        </p>
        {/* Both clocks, once it is booked. The one number a candidate will
            re-read is the time, and the zone it was shown in is exactly what
            they will forget. */}
        {viewerZone && (
          <p className="mt-2 text-sm text-[#6B7280]">
            {new Intl.DateTimeFormat("en-US", {
              timeZone: timezone,
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(done))}{" "}
            for the interviewer · {timezone}
          </p>
        )}
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Times shown in {activeZone}. A calendar invitation and a joining link are on
          their way to your inbox. If the time needs to change, the hiring team will
          email you to pick again — you never have to cancel anything yourself.
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F4F6]">
          <svg className="h-6 w-6 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-[#6B7280]">
          There are no interview times available right now. Please check back later, or contact the
          hiring team.
        </p>
      </div>
    );
  }

  const selectedSlot = selected ? slots.find((s) => s.startIso === selected) ?? null : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
      {/* Header: context + timezone */}
      <div className="flex items-start justify-between gap-3 border-b border-[#F3F4F6] px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">
            {isReschedule ? "Pick a new time" : "Select a time"}
          </h2>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            {isReschedule
              ? `Choose a new slot for your ${campaignTitle} interview.`
              : `Pick a slot for your ${campaignTitle} interview.`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3F4F6] px-2.5 py-1 text-xs font-medium text-[#374151]">
            <svg className="h-3.5 w-3.5 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 000 18 15 15 0 000-18z" />
            </svg>
            <span className="max-w-[11rem] truncate">{activeZone}</span>
          </span>
          {viewerZone && (
            <div
              role="group"
              aria-label="Show times in"
              className="mt-1.5 inline-flex rounded-lg border border-[#E5E7EB] p-0.5"
            >
              <button
                type="button"
                onClick={() => setShowTheirs(false)}
                aria-pressed={!showTheirs}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  showTheirs ? "text-[#6B7280] hover:text-ink" : "bg-ink text-white"
                }`}
              >
                My time
              </button>
              <button
                type="button"
                onClick={() => setShowTheirs(true)}
                aria-pressed={showTheirs}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  showTheirs ? "bg-ink text-white" : "text-[#6B7280] hover:text-ink"
                }`}
              >
                Theirs
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        {recommended.length > 0 && (
          <div>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#111827]">
              <svg className="h-3.5 w-3.5 text-[#2563EB]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" />
              </svg>
              Soonest available
            </h3>
            <div className="flex flex-wrap gap-2">
              {recommended.map((slot) => {
                const isSelected = selected === slot.startIso;
                return (
                  <button
                    key={slot.startIso}
                    type="button"
                    onClick={() => setSelected(slot.startIso)}
                    aria-pressed={isSelected}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 ${
                      isSelected
                        ? "border-[#111827] bg-[#111827] text-white"
                        : "border-[#E5E7EB] bg-white text-[#374151] hover:border-[#111827] hover:bg-[#F9FAFB]"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span>{dayFmt.format(new Date(slot.startIso))} · {timeFmt.format(new Date(slot.startIso))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-5">
          {groups.map((daySlots) => (
            <div key={daySlots[0].dayKey}>
              <div className="mb-2.5 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-[#111827]">
                  {dayFmt.format(new Date(daySlots[0].startIso))}
                </h3>
                <span className="text-xs text-[#9CA3AF]">
                  {daySlots.length} {daySlots.length === 1 ? "time" : "times"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {daySlots.map((slot) => {
                  const isSelected = selected === slot.startIso;
                  return (
                    <button
                      key={slot.startIso}
                      type="button"
                      onClick={() => setSelected(slot.startIso)}
                      aria-pressed={isSelected}
                      className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 ${
                        isSelected
                          ? "border-[#111827] bg-[#111827] text-white"
                          : "border-[#E5E7EB] bg-white text-[#374151] hover:border-[#111827] hover:bg-[#F9FAFB]"
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

        {/* Two things a candidate cannot tell by looking: whether these times
            are really free, and whether choosing one has already committed
            them. Both matter more than the grid itself. */}
        <p className="text-xs leading-relaxed text-[#6B7280]">
          These are the interviewer&apos;s open hours with their existing meetings
          already removed, so every time shown is genuinely free. Nothing is held
          until you confirm.
        </p>
      </div>

      {/* Selection summary + confirm — the deliberate final step. */}
      <div className="border-t border-[#F3F4F6] bg-[#FAFAFA] px-5 py-4 sm:px-6">
        {error && (
          <p className="mb-3 flex items-start gap-2 text-sm text-red-600" role="alert">
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M12 3l9 16H3l9-16z" />
            </svg>
            {error}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {selectedSlot ? (
              <>
                <span className="block text-xs uppercase tracking-wider text-[#9CA3AF]">Your selection</span>
                <span className="mt-0.5 block font-medium text-[#111827]">
                  {dayFmt.format(new Date(selectedSlot.startIso))} at {timeFmt.format(new Date(selectedSlot.startIso))}
                </span>
              </>
            ) : (
              <span className="text-[#6B7280]">Select a time above to continue.</span>
            )}
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={!selected || pending}
            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[#111827] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors outline-none hover:bg-[#374151] focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#9CA3AF] disabled:opacity-70 sm:w-auto"
          >
            {pending && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {pending
              ? isReschedule
                ? "Updating…"
                : "Booking…"
              : isReschedule
                ? "Confirm new time"
                : "Confirm interview time"}
          </button>
        </div>
      </div>
    </div>
  );
}
