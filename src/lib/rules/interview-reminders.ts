/**
 * Pure decision: which reminder, if any, is owed to a candidate about their
 * booked final interview right now?
 *
 * The sweep that calls this has no opinion — it selects bookings in a window,
 * asks here, and executes. Everything about *when* a reminder is appropriate
 * lives in this file so it can be reasoned about without a clock or a database.
 *
 * Note the sweep's cadence is deliberately NOT encoded here. The rule answers
 * "what is owed at this instant", which stays correct whether it is asked every
 * hour or once a day — a run that misses the ideal moment still sends the right
 * single email the next time it is asked.
 */

export type InterviewReminderKind = "24h" | "1h";

/** How far ahead of the interview each reminder is meant to land. */
export const INTERVIEW_REMINDER_LEAD_MS: Record<InterviewReminderKind, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

/** Nearest lead first — the order the rule prefers when more than one is due. */
const KINDS_BY_URGENCY: readonly InterviewReminderKind[] = ["1h", "24h"];

/** The booking columns the decision reads. */
export interface RemindableBooking {
  /** ISO start of the interview. */
  scheduled_at: string;
  /** ISO time the candidate chose the slot (and got their confirmation email). */
  created_at: string;
  /** `booked` | `pending_reschedule` — only the former is remindable. */
  status: string;
  reminder_24h_sent_at: string | null;
  reminder_1h_sent_at: string | null;
}

export interface ReminderDecision {
  /** The single reminder to send now, or null. */
  send: InterviewReminderKind | null;
  /**
   * Reminders to stamp as handled WITHOUT sending: their moment has passed, or
   * the booking confirmation already covered them. Stamping retires them so a
   * later run can't fire a message that is no longer true.
   */
  supersede: InterviewReminderKind[];
}

const NOTHING: ReminderDecision = { send: null, supersede: [] };

function sentAt(booking: RemindableBooking, kind: InterviewReminderKind): string | null {
  return kind === "24h" ? booking.reminder_24h_sent_at : booking.reminder_1h_sent_at;
}

export function dueInterviewReminders(
  booking: RemindableBooking,
  now: Date = new Date(),
): ReminderDecision {
  // A booking waiting for the candidate to re-pick has no true time to remind
  // about; the reschedule email is the message they should be acting on.
  if (booking.status !== "booked") return NOTHING;

  const scheduledAt = Date.parse(booking.scheduled_at);
  if (Number.isNaN(scheduledAt)) return NOTHING;

  // Past the start time there is nothing left to be early for, and a late
  // "coming up" email reads as a system that has lost track of the candidate.
  const msUntil = scheduledAt - now.getTime();
  if (msUntil <= 0) return NOTHING;

  // An unreadable creation time must not suppress a reminder — a missing
  // reminder is the costlier failure, so redundancy checks fail open.
  const bookedAt = Date.parse(booking.created_at);
  const bookedAtKnown = !Number.isNaN(bookedAt);

  let send: InterviewReminderKind | null = null;
  const supersede: InterviewReminderKind[] = [];

  for (const kind of KINDS_BY_URGENCY) {
    if (sentAt(booking, kind) !== null) continue;

    const lead = INTERVIEW_REMINDER_LEAD_MS[kind];

    // The candidate booked inside this window, so the confirmation email they
    // just received already named the time. Retire it rather than repeat it.
    if (bookedAtKnown && bookedAt > scheduledAt - lead) {
      supersede.push(kind);
      continue;
    }

    if (msUntil > lead) continue;

    // Nearest lead wins; anything else still outstanding is stale by now, and
    // two emails a minute apart is worse than one accurate one.
    if (send === null) send = kind;
    else supersede.push(kind);
  }

  return { send, supersede };
}

/**
 * Application states in which a booked interview is still going to happen.
 *
 * An allowlist, not a denylist: a booking row outlives the decision that made it
 * (a candidate rejected the day before their final interview keeps their row),
 * and a state nobody anticipated must default to sending nothing rather than to
 * emailing someone who has already been turned down.
 *
 *   - `final_interview_scheduling` — the mainline. The application rests here
 *     from booking until the recruiter records hired/rejected.
 *   - `interview_scheduled` — the deprecated AI-interview booking path, kept
 *     while pre-reroute links are still in flight.
 */
export const REMINDABLE_APPLICATION_STATES: readonly string[] = [
  "final_interview_scheduling",
  "interview_scheduled",
];

export function isRemindableApplicationState(state: string): boolean {
  return REMINDABLE_APPLICATION_STATES.includes(state);
}
