import type { ReactNode } from "react";
import MatiousLogo from "@/components/matious-logo";
import { cn } from "@/lib/utils";

/**
 * The card every candidate-facing page is served in.
 *
 * Candidate pages have no sidebar and no navbar — there is nowhere else to go
 * and nothing else to do, and a nervous person on the other end of a hiring
 * process does not need navigation. What they need is to know whose process
 * this is, which is why the header is the employer's brand rather than ours.
 *
 * Shared by the voice screening and the video interview deliberately: the two
 * are the same promise at different lengths, and a candidate who has done one
 * should recognise the second immediately.
 */

export type ShellTone = "idle" | "busy" | "live" | "info";

const DOT: Record<ShellTone, string> = {
  idle: "bg-[#94A3B8]",
  // Amber and moving: something is happening that the candidate must wait for.
  busy: "bg-[#F59E0B] motion-safe:animate-pulse",
  live: "bg-[#22C55E]",
  info: "bg-primary",
};

export function CandidateShell({
  title,
  role,
  status,
  children,
  footer = true,
}: {
  /** "Video interview" / "Voice screening". */
  title: string;
  /** The campaign the candidate applied to. */
  role?: string;
  /** Omitted on the standalone error and already-done pages, which have no
   *  state machine to report on. */
  status?: {
    label: string;
    tone: ShellTone;
    /** "7:12" — present only while a call is running. */
    clock?: string;
    /** Under a minute: the one thing on this page allowed to turn red. */
    clockUrgent?: boolean;
  };
  children: ReactNode;
  footer?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#F7F7F8]">
      <div className="flex justify-center px-6 pb-2 pt-12">
        <div className="w-full max-w-[720px]">
          <div className="overflow-hidden rounded-[20px] border border-[#E5E7EB] bg-white shadow-[0_10px_15px_-3px_rgba(0,0,0,0.06),0_4px_6px_-2px_rgba(0,0,0,0.04)]">
            {/* The employer's band, not ours. Two stops of the same navy — the
                brand's own colour, not ornament on a feature. */}
            <div className="bg-[linear-gradient(135deg,#2B3A78,#161C3D)] px-10 py-[30px] text-white">
              <MatiousLogo className="mb-1.5 text-[15px] tracking-[-0.02em] text-white/90" />
              <h1 className="mb-1 font-heading text-[30px] font-semibold tracking-[-0.015em]">
                {title}
              </h1>
              {role && <p className="text-[15px] text-white/75">{role}</p>}
            </div>

            {status && (
              <div className="flex items-center justify-between gap-3 border-b border-[#F3F4F6] px-10 py-4">
                <span className="flex items-center gap-[9px]">
                  <span
                    className={cn("h-[9px] w-[9px] rounded-full", DOT[status.tone])}
                    aria-hidden="true"
                  />
                  <span
                    role="status"
                    aria-live="polite"
                    className="text-sm font-semibold text-ink"
                  >
                    {status.label}
                  </span>
                </span>

                {status.clock && (
                  <span
                    role="timer"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-sm font-semibold tabular-nums",
                      // Blue while there is time, red under a minute. The
                      // countdown is a fact about the page rather than
                      // something to act on, so it wears the informational
                      // family — the same pair as ShellIcon's `info` tone —
                      // and the single change to red stays the only alarm.
                      status.clockUrgent
                        ? "bg-[#FEF2F2] text-[#DC2626]"
                        : "bg-[#EFF6FF] text-[#1D4ED8]",
                    )}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                    {status.clock}
                  </span>
                )}
              </div>
            )}

            <div className="px-10 pb-10 pt-9">{children}</div>
          </div>

          {footer && (
            <p className="mt-4 text-center text-[13px] leading-[1.6] text-[#9CA3AF]">
              Trouble with the link? Reply to the email we sent you and a person
              will help.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The 88px disc every terminal state opens with. */
export function ShellIcon({
  tone,
  children,
}: {
  tone: "neutral" | "info" | "good" | "warn" | "bad";
  children: ReactNode;
}) {
  const TONE = {
    neutral: "bg-[#F3F4F6] text-[#4B5563]",
    info: "bg-[#EFF6FF] text-primary",
    good: "bg-[#ECFDF5] text-[#059669]",
    warn: "bg-[#FFFBEB] text-[#B45309]",
    bad: "bg-[#FEF2F2] text-[#DC2626]",
  } as const;

  return (
    <div className="mb-5 flex justify-center">
      <span
        className={cn(
          "flex h-[88px] w-[88px] items-center justify-center rounded-full",
          TONE[tone],
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** Full-width, 54px. The only ink button on a candidate page. */
export const SHELL_PRIMARY =
  "mx-auto flex w-full max-w-[420px] min-h-[54px] cursor-pointer items-center justify-center gap-2.5 " +
  "rounded-xl bg-ink px-4 text-base font-semibold text-white transition-colors duration-150 " +
  "hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink " +
  "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const SHELL_SECONDARY =
  "mx-auto flex w-full max-w-[420px] min-h-[50px] cursor-pointer items-center justify-center gap-2.5 " +
  "rounded-xl border border-[#D1D5DB] bg-white px-4 text-[15px] font-semibold text-[#374151] " +
  "transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Centred 19px heading — every terminal state opens with one. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-center text-[19px] font-semibold text-ink">{children}</p>
  );
}

/** The paragraph under a Heading. */
export function Body({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mb-6 max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
      {children}
    </p>
  );
}

/** One promise, ticked. Used only in the pre-call list. */
export function Assurance({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-[11px] text-sm leading-[1.5] text-[#374151]">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export function Deadline({ expiresAt }: { expiresAt?: string }) {
  if (!expiresAt) return null;
  return (
    <p className="mt-3.5 text-center text-[13px] text-[#6B7280]">
      Please complete by{" "}
      <strong className="font-semibold text-[#374151]">
        {formatDeadline(expiresAt)}
      </strong>
      .
    </p>
  );
}

/** Heroicons outline, inline. One wrapper so stroke width and caps never drift. */
export function Icon({
  d,
  className = "h-8 w-8",
  strokeWidth = 1.6,
}: {
  d: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/** "7:12". The live call clock, in the status bar and in the copy that quotes it. */
export function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
