import { describe, expect, it } from "vitest";
import {
  dueInterviewReminders,
  INTERVIEW_REMINDER_LEAD_MS,
  isRemindableApplicationState,
  type RemindableBooking,
} from "./interview-reminders";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-10T09:00:00.000Z");

/** A booking made well in advance, with no reminder sent yet. */
function booking(overrides: Partial<RemindableBooking> = {}): RemindableBooking {
  return {
    scheduled_at: new Date(NOW.getTime() + 30 * HOUR).toISOString(),
    created_at: new Date(NOW.getTime() - 10 * 24 * HOUR).toISOString(),
    status: "booked",
    reminder_24h_sent_at: null,
    reminder_1h_sent_at: null,
    ...overrides,
  };
}

/** Move the interview to exactly `hours` from NOW. */
function inHours(hours: number): string {
  return new Date(NOW.getTime() + hours * HOUR).toISOString();
}

describe("dueInterviewReminders — the windows", () => {
  it("sends nothing while the interview is more than a day away", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: inHours(30) }), NOW);

    expect(decision).toEqual({ send: null, supersede: [] });
  });

  it("sends the 24h reminder once the interview is inside a day", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: inHours(20) }), NOW);

    expect(decision.send).toBe("24h");
  });

  it("sends the 1h reminder in the final hour", () => {
    const decision = dueInterviewReminders(
      booking({
        scheduled_at: inHours(0.5),
        reminder_24h_sent_at: new Date(NOW.getTime() - 12 * HOUR).toISOString(),
      }),
      NOW,
    );

    expect(decision.send).toBe("1h");
  });

  it("treats the exact lead boundary as due", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: inHours(24) }), NOW);

    expect(decision.send).toBe("24h");
  });

  it("does not resend a reminder that already went out", () => {
    const decision = dueInterviewReminders(
      booking({
        scheduled_at: inHours(20),
        reminder_24h_sent_at: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
      NOW,
    );

    expect(decision).toEqual({ send: null, supersede: [] });
  });
});

describe("dueInterviewReminders — one email at a time", () => {
  /**
   * A cron outage can leave both reminders unsent until half an hour before the
   * call. Firing both then would land two emails in the same minute, one of
   * which ("coming up tomorrow") is already false.
   */
  it("sends only the nearest reminder when a gap left both unsent", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: inHours(0.5) }), NOW);

    expect(decision.send).toBe("1h");
    expect(decision.supersede).toEqual(["24h"]);
  });

  it("never returns the same reminder as both sent and superseded", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: inHours(0.5) }), NOW);

    expect(decision.supersede).not.toContain(decision.send);
  });
});

describe("dueInterviewReminders — redundant against the confirmation", () => {
  /**
   * Booking a slot three hours out already produced a confirmation email naming
   * the time. A "reminder" minutes later repeats it — so a window that had
   * already elapsed when the candidate chose the slot is retired unsent.
   */
  it("does not remind about a window that had passed when the slot was booked", () => {
    const decision = dueInterviewReminders(
      booking({ scheduled_at: inHours(3), created_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }),
      NOW,
    );

    expect(decision.send).toBeNull();
    expect(decision.supersede).toEqual(["24h"]);
  });

  it("still sends the final-hour nudge for a same-day booking", () => {
    const bookedThreeHoursOut = booking({
      scheduled_at: inHours(0.5),
      // Booked when the interview was 3h away: too late for a 24h notice,
      // in good time for the 1h one.
      created_at: new Date(NOW.getTime() - 2.5 * HOUR).toISOString(),
    });

    const decision = dueInterviewReminders(bookedThreeHoursOut, NOW);

    expect(decision.send).toBe("1h");
    expect(decision.supersede).toEqual(["24h"]);
  });

  it("falls back to sending when the booking has an unreadable creation time", () => {
    const decision = dueInterviewReminders(
      booking({ scheduled_at: inHours(20), created_at: "not a date" }),
      NOW,
    );

    expect(decision.send).toBe("24h");
  });
});

describe("dueInterviewReminders — when to stay quiet", () => {
  /**
   * `pending_reschedule` means the recruiter moved the meeting and the
   * candidate has been asked to re-pick. Reminding them of the old time would
   * send them to a slot nobody will be at.
   */
  it("stays silent while a booking is awaiting a reschedule", () => {
    const decision = dueInterviewReminders(
      booking({ scheduled_at: inHours(2), status: "pending_reschedule" }),
      NOW,
    );

    expect(decision).toEqual({ send: null, supersede: [] });
  });

  it("stays silent once the interview start time has passed", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: inHours(-0.25) }), NOW);

    expect(decision).toEqual({ send: null, supersede: [] });
  });

  it("stays silent on an unreadable scheduled time rather than guessing one", () => {
    const decision = dueInterviewReminders(booking({ scheduled_at: "sometime" }), NOW);

    expect(decision).toEqual({ send: null, supersede: [] });
  });
});

describe("INTERVIEW_REMINDER_LEAD_MS", () => {
  it("names the leads the PRD asks for", () => {
    expect(INTERVIEW_REMINDER_LEAD_MS["24h"]).toBe(24 * HOUR);
    expect(INTERVIEW_REMINDER_LEAD_MS["1h"]).toBe(HOUR);
  });
});

describe("isRemindableApplicationState", () => {
  it("reminds while the interview is still going to happen", () => {
    expect(isRemindableApplicationState("final_interview_scheduling")).toBe(true);
    expect(isRemindableApplicationState("interview_scheduled")).toBe(true);
  });

  /**
   * The booking row survives the decision that closed the application, so this
   * is the guard that stops a rejected candidate being reminded to attend.
   */
  it("says nothing to a candidate whose application was closed after booking", () => {
    expect(isRemindableApplicationState("rejected")).toBe(false);
    expect(isRemindableApplicationState("hired")).toBe(false);
    expect(isRemindableApplicationState("archived")).toBe(false);
  });

  it("defaults to silence on a state it has never heard of", () => {
    expect(isRemindableApplicationState("some_future_state")).toBe(false);
  });
});
