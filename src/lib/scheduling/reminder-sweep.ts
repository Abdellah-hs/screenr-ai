import type { gmail_v1 } from "googleapis/build/src/apis/gmail";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  claimInterviewReminder,
  fetchBookingsInReminderWindow,
  releaseInterviewReminder,
  type ReminderWindowBooking,
} from "@/lib/data/scheduling";
import {
  dueInterviewReminders,
  INTERVIEW_REMINDER_LEAD_MS,
  isRemindableApplicationState,
  type InterviewReminderKind,
} from "@/lib/rules/interview-reminders";
import { getRecruiterGmailClient } from "@/lib/actions/gmail-sender";
import { sendEmail } from "@/lib/services/email";
import { buildInterviewReminderEmail } from "@/lib/services/email-templates/interview-reminder";

/**
 * How far ahead the sweep looks. The widest reminder lead and nothing more —
 * anything further out has nothing owed yet, and will be picked up by a later
 * run without a reminder ever being missed.
 */
const REMINDER_WINDOW_MS = INTERVIEW_REMINDER_LEAD_MS["24h"];

export interface InterviewReminderSweepResult {
  /** Booked interviews found inside the reminder window. */
  scanned: number;
  /** Reminder emails actually delivered. */
  sent: number;
  /** Reminders retired unsent because their moment had passed. */
  superseded: number;
  /** Bookings the sweep deliberately left alone (nothing due, or not remindable). */
  skipped: number;
  /** Reminders that failed mid-flight; logged, not thrown, and retried next run. */
  failed: number;
}

/**
 * Scheduled sweep that sends the 24h / 1h reminders ahead of a booked final
 * human interview (#72).
 *
 * The interview reminder template has existed since #31 with nothing driving
 * it, because a reminder is time-triggered and the codebase had no scheduler.
 * This is that driver: it runs session-less (admin client, campaign owner's
 * connected inbox) and is invoked from `/api/cron/interview-reminders`.
 *
 * **Correct at any cadence.** The rule answers "what is owed right now", so a
 * run that misses the ideal moment still sends the right single email the next
 * time it is asked, and a run that fires twice in a minute sends nothing extra.
 * Note the practical consequence: on a once-a-day schedule the 24h reminder
 * lands (somewhere inside the final day) but the 1h one effectively cannot —
 * the final hour has to be looked at to be caught. See the cron route.
 *
 * Every booking is handled independently: one failure is logged and the sweep
 * continues, so a recruiter with a disconnected inbox cannot strand another
 * recruiter's candidates.
 */
export async function sweepInterviewReminders(
  now: Date = new Date(),
): Promise<InterviewReminderSweepResult> {
  const db = createAdminClient();
  const bookings = await fetchBookingsInReminderWindow(now, REMINDER_WINDOW_MS, db);

  // One inbox lookup per recruiter, not per candidate: a campaign closing out
  // twenty final interviews would otherwise refresh the same OAuth token twenty
  // times. Failures are cached too, so a disconnected inbox is not retried once
  // per candidate in the same pass.
  const gmailByOwner = new Map<string, Promise<gmail_v1.Gmail>>();
  const gmailFor = (ownerUserId: string): Promise<gmail_v1.Gmail> => {
    const existing = gmailByOwner.get(ownerUserId);
    if (existing) return existing;
    const client = getRecruiterGmailClient(ownerUserId, db);
    gmailByOwner.set(ownerUserId, client);
    return client;
  };

  const result: InterviewReminderSweepResult = {
    scanned: bookings.length,
    sent: 0,
    superseded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const booking of bookings) {
    // A booking row outlives the decision that made it. Check the application
    // before the clock: someone rejected the day before their final interview
    // must not be reminded to attend it.
    if (!isRemindableApplicationState(booking.application_status)) {
      result.skipped += 1;
      continue;
    }

    if (!booking.candidate_email) {
      console.warn(
        `Interview reminder skipped for ${booking.application_id}: no candidate email on record.`,
      );
      result.skipped += 1;
      continue;
    }

    const decision = dueInterviewReminders(booking, now);
    if (!decision.send && decision.supersede.length === 0) {
      result.skipped += 1;
      continue;
    }

    // Retire the stale ones first, so a crash between here and the send can
    // never leave a "coming up tomorrow" email queued for an hour from now.
    for (const kind of decision.supersede) {
      try {
        if (await claimInterviewReminder({ applicationId: booking.application_id, kind, at: now, db })) {
          result.superseded += 1;
        }
      } catch (err) {
        console.error(
          `Retiring the ${kind} interview reminder for ${booking.application_id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (!decision.send) continue;

    try {
      const sent = await sendReminder(booking, decision.send, now, gmailFor, db);
      // A lost claim means a concurrent run owns this reminder — not a send,
      // and not a failure either.
      if (sent) result.sent += 1;
      else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      console.error(
        `Interview reminder (${decision.send}) failed for ${booking.application_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return result;
}

/**
 * Claim, then send. The claim is a conditional write that at most one caller can
 * win, which is what makes a duplicate email impossible rather than merely
 * unlikely — an email cannot be recalled, so the ordering has to be pessimistic.
 *
 * If the send then fails, the claim is handed back so the next run retries. The
 * narrow risk that accepts is a send that landed but reported failure: one
 * duplicate reminder, which is much the cheaper of the two mistakes.
 */
async function sendReminder(
  booking: ReminderWindowBooking,
  kind: InterviewReminderKind,
  now: Date,
  gmailFor: (ownerUserId: string) => Promise<gmail_v1.Gmail>,
  db: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  const claimed = await claimInterviewReminder({
    applicationId: booking.application_id,
    kind,
    at: now,
    db,
  });
  // Another run got there first. Nothing owed, nothing to undo.
  if (!claimed) return false;

  try {
    const gmail = await gmailFor(booking.owner_user_id);
    const email = buildInterviewReminderEmail({
      candidateName: booking.candidate_name,
      campaignTitle: booking.campaign_title,
      interviewAt: new Date(booking.scheduled_at),
      joinUrl: booking.meet_url ?? undefined,
      timeZone: booking.timezone,
    });

    await sendEmail(gmail, {
      to: booking.candidate_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    return true;
  } catch (err) {
    await releaseInterviewReminder({
      applicationId: booking.application_id,
      kind,
      db,
    }).catch((releaseErr) =>
      console.error(
        `Releasing the ${kind} reminder claim for ${booking.application_id} failed:`,
        releaseErr instanceof Error ? releaseErr.message : releaseErr,
      ),
    );
    throw err;
  }
}
