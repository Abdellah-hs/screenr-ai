"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod/v4";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { bookInterviewSlotSchema, uuidSchema } from "@/lib/validations";
import {
  fetchSchedulingContext,
  fetchBookingForApplication,
  fetchBookingForRecruiter,
  fetchBookingCalendarEventId,
  insertBooking,
  updateBooking,
  setBookingCalendarEventId,
  BOOKING_STATUS_BOOKED,
  BOOKING_STATUS_PENDING_RESCHEDULE,
  type InterviewBooking,
} from "@/lib/data/scheduling";
import {
  pickRecommendedSlots,
  type GeneratedSlot,
} from "@/lib/scheduling/slots";
import { resolveAvailableSlots, type ResolvedSlots } from "@/lib/scheduling/available-slots";
import {
  createBookingCalendarEvent,
  updateBookingCalendarEvent,
} from "@/lib/scheduling/booking-event";
import {
  ensureWatchChannel,
  GOOGLE_CALENDAR_WEBHOOK_PATH,
} from "@/lib/scheduling/calendar-sync";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";
import { getRequestOrigin } from "@/lib/http/origin";
import { getRecruiterGmailClient } from "./gmail-sender";
import { sendEmail } from "@/lib/services/email";
import { buildInterviewConfirmationEmail } from "@/lib/services/email-templates/interview-confirmation";

const SCHEDULE_RATE_LIMIT = {
  maxRequests: 20,
  windowMs: 10 * 60 * 1000,
} as const;

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Recruiter-facing read of a candidate's interview booking, for the candidate
 * detail page. Auth'd by session; the underlying query runs under owner RLS, so
 * a recruiter only ever sees bookings on their own campaigns' applications.
 * Returns null when the candidate hasn't booked (or there is no booking row).
 */
export async function getInterviewBooking(
  applicationId: string,
): Promise<InterviewBooking | null> {
  await requireUserId();
  uuidSchema.parse(applicationId);
  return fetchBookingForRecruiter(applicationId);
}

export interface SchedulingPageContext {
  campaign_title: string;
  /** The candidate's confirmed booking (only when settled — not while re-picking). */
  booking: InterviewBooking | null;
  /**
   * The recruiter moved the confirmed time on their calendar, so the candidate
   * is being asked to pick again. The picker is shown (in "reschedule" mode)
   * instead of the confirmation card.
   */
  needs_reschedule: boolean;
  /** Available slots to choose from (empty when already booked or blocked). */
  slots: GeneratedSlot[];
  /** Slot starts (ISO) to highlight as recommended picks. */
  recommended_iso: string[];
  timezone: string | null;
  /**
   * The interviewer's Google Calendar couldn't be consulted, so no slots are
   * offered (strict mode — never show a time we can't confirm is free). The
   * page renders a candidate-safe "temporarily unavailable" notice.
   */
  calendar_unavailable: boolean;
  /**
   * The calendar was read fine but no bookable business-hours window falls in
   * the horizon (only a degenerate weekend-only horizon).
   */
  no_hours: boolean;
}

/**
 * Loads the candidate scheduling page (token-gated, read-only). Three cases,
 * keyed on the booking's status:
 *   - confirmed (`booked`)          → return the booking; the page shows the
 *     static confirmation card, no picker.
 *   - pending reschedule            → the recruiter moved the time; show the
 *     picker in "reschedule" mode (fresh slots, `needs_reschedule` true).
 *   - no booking yet                → show the picker in "book" mode.
 */
export async function loadSchedulingContext(
  token: string,
): Promise<SchedulingPageContext> {
  const { application_id } = verifyResponseToken(token);

  const ctx = await fetchSchedulingContext(application_id);
  if (!ctx) {
    throw new Error(
      "We couldn't find this application. Please contact the hiring team.",
    );
  }

  const booking = await fetchBookingForApplication(application_id);

  // Settled booking → static confirmation, no picker.
  if (booking && booking.status === BOOKING_STATUS_BOOKED) {
    return {
      campaign_title: ctx.campaign_title,
      booking,
      needs_reschedule: false,
      slots: [],
      recommended_iso: [],
      timezone: ctx.timezone,
      calendar_unavailable: false,
      no_hours: false,
    };
  }

  // Otherwise the picker is shown: a fresh candidate, or one asked to re-pick
  // after the recruiter moved the time. `needs_reschedule` drives the copy.
  const needsReschedule = booking?.status === BOOKING_STATUS_PENDING_RESCHEDULE;
  const resolved = await resolveAvailableSlots(ctx);
  return assemblePickerContext(ctx.campaign_title, ctx.timezone, needsReschedule, resolved, application_id);
}

/** Map a resolved-slots result to the picker's page context (book or reschedule). */
function assemblePickerContext(
  campaignTitle: string,
  fallbackTimezone: string | null,
  needsReschedule: boolean,
  resolved: ResolvedSlots,
  applicationId: string,
): SchedulingPageContext {
  const base = {
    campaign_title: campaignTitle,
    booking: null,
    needs_reschedule: needsReschedule,
    slots: [] as GeneratedSlot[],
    recommended_iso: [] as string[],
  };

  // Strict calendar gate: no consultable calendar → no slots at all.
  if (resolved.status === "calendar_unavailable") {
    console.warn(
      `loadSchedulingContext: calendar unavailable (${resolved.reason}) for application ${applicationId}`,
    );
    return { ...base, timezone: fallbackTimezone, calendar_unavailable: true, no_hours: false };
  }

  if (resolved.status === "no_hours") {
    return { ...base, timezone: resolved.timezone, calendar_unavailable: false, no_hours: true };
  }

  return {
    ...base,
    slots: resolved.slots,
    recommended_iso: pickRecommendedSlots(resolved.slots),
    timezone: resolved.timezone,
    calendar_unavailable: false,
    no_hours: false,
  };
}

/**
 * Application states from which a candidate may book a slot:
 *   - `final_interview_scheduling` — the mainline: booking the final human
 *     interview after manager review. The booking row is the artifact; the
 *     application stays in this state until the recruiter records the outcome
 *     (hired / rejected).
 *   - `interview_scheduling` — DEPRECATED inbound path (pre-reroute links that
 *     booked the AI interview). Kept so in-flight candidates holding a live
 *     link can still book; these advance to `interview_scheduled` as before.
 */
const BOOKABLE_STATES = ["final_interview_scheduling", "interview_scheduling"];

/** Context shape resolveAvailableSlots consumes (a subset of SchedulingContext). */
interface SlotResolutionContext {
  owner_user_id: string;
  booking_horizon_days: number;
  campaign_id: string;
  slot_minutes: number;
  timezone: string | null;
}

/**
 * Re-resolve live availability and confirm `startIso` is a currently-offered
 * slot — the server is the source of truth, so both booking and reschedule
 * re-validate here rather than trusting the client's claim. Throws a
 * candidate-facing error when the calendar can't be consulted or the slot is
 * gone. Returns the matched slot and the timezone it's labeled in.
 */
async function requireAvailableSlot(
  ctx: SlotResolutionContext,
  startIso: string,
  logLabel: string,
): Promise<{ match: GeneratedSlot; timezone: string }> {
  const resolved = await resolveAvailableSlots(ctx);
  if (resolved.status === "calendar_unavailable") {
    console.warn(`${logLabel}: calendar unavailable (${resolved.reason})`);
    throw new Error(
      "Booking is temporarily unavailable. Please try again shortly, or contact the hiring team.",
    );
  }
  if (resolved.status === "no_hours") {
    throw new Error(
      "Interview times aren't open for this role yet. Please contact the hiring team.",
    );
  }

  const chosenMs = new Date(startIso).getTime();
  const match = resolved.slots.find((s) => new Date(s.startIso).getTime() === chosenMs);
  if (!match) {
    throw new Error("That time isn't available. Please pick another slot.");
  }
  return { match, timezone: resolved.timezone };
}

/**
 * Books a slot for the candidate. Verifies the token + rate-limits, re-validates
 * the chosen slot against freshly generated availability (the server is the
 * source of truth), persists the booking, and sends a confirmation email from
 * the campaign owner's inbox (best-effort). Legacy `interview_scheduling`
 * applications additionally advance to `interview_scheduled` via the system
 * transition.
 */
export async function bookInterviewSlot(input: {
  token: string;
  start_iso: string;
}): Promise<{ ok: true }> {
  let parsed;
  try {
    parsed = bookInterviewSlotSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues[0]?.message ?? "Invalid booking");
    }
    throw err;
  }

  const { application_id } = verifyResponseToken(parsed.token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "interview-booking", ...SCHEDULE_RATE_LIMIT });

  const ctx = await fetchSchedulingContext(application_id);
  if (!ctx) {
    throw new Error(
      "This link is no longer active. Please contact the hiring team.",
    );
  }
  if (!BOOKABLE_STATES.includes(ctx.status)) {
    throw new Error(
      "This interview is already scheduled or no longer open for booking.",
    );
  }
  // Strict calendar gate + slot re-validation, re-checked at booking time: refuse
  // if the interviewer's calendar can't be consulted right now rather than risk a
  // conflict. Regenerates the exact list the page offered (shared helper), so a
  // slot that was free at page load but is taken now can no longer be booked.
  const { match, timezone } = await requireAvailableSlot(
    ctx,
    parsed.start_iso,
    `bookInterviewSlot ${application_id}`,
  );

  // Persist first (unique constraints are the race backstop), then advance.
  await insertBooking({
    applicationId: application_id,
    campaignId: ctx.campaign_id,
    scheduledAtIso: match.startIso,
    slotMinutes: ctx.slot_minutes,
    timezone,
  });

  // Only the deprecated AI-interview booking path has a follow-up state. A
  // final-interview booking rests at `final_interview_scheduling` — the booking
  // row records the slot, and the recruiter's hire/reject decision is the exit.
  if (ctx.status === "interview_scheduling") {
    await transitionApplicationAsSystem(
      application_id,
      "interview_scheduled",
      "Candidate booked an interview slot",
    );
  }

  // Capture the origin now, in request scope, for the watch-channel webhook URL
  // (after() may run outside a request where headers aren't available).
  const origin = await getRequestOrigin();

  // The booking is durable — everything below is slow third-party work (Google
  // Calendar event + Meet room, watch-channel setup, confirmation email), so it
  // runs AFTER the response and the candidate sees their confirmation instantly.
  // Every step is best-effort; failures log and never surface to the candidate.
  after(async () => {
    const db = createAdminClient();

    const { meetUrl, eventId } = await createBookingCalendarEvent({
      ownerUserId: ctx.owner_user_id,
      applicationId: application_id,
      candidateName: ctx.candidate_name,
      candidateEmail: ctx.candidate_email,
      campaignTitle: ctx.campaign_title,
      startIso: match.startIso,
      slotMinutes: ctx.slot_minutes,
      timeZone: timezone,
    });

    // Persist the event id so a later recruiter reschedule moves THIS event, and
    // open a watch channel so we hear about those edits.
    if (eventId) {
      try {
        await setBookingCalendarEventId(application_id, eventId, db);
      } catch (err) {
        console.error(
          "Storing calendar event id failed:",
          err instanceof Error ? err.message : err,
        );
      }
      await ensureWatchChannel({
        ownerUserId: ctx.owner_user_id,
        webhookUrl: `${origin}${GOOGLE_CALENDAR_WEBHOOK_PATH}`,
        db,
      });
    }

    try {
      // Admin db: this is a candidate request — there is no recruiter session,
      // so the cookie client would hit owner-only RLS and find no connection.
      const gmail = await getRecruiterGmailClient(ctx.owner_user_id, db);
      const email = buildInterviewConfirmationEmail({
        candidateName: ctx.candidate_name,
        campaignTitle: ctx.campaign_title,
        interviewAt: new Date(match.startIso),
        meetUrl: meetUrl ?? undefined,
      });
      await sendEmail(gmail, {
        to: ctx.candidate_email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      console.error(
        "Interview confirmation email failed:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return { ok: true };
}

/**
 * Confirm a new time after the recruiter moved the interview on their calendar
 * (which flipped the booking to `pending_reschedule` and emailed the candidate
 * back here). Mirrors `bookInterviewSlot`: verify token, rate-limit,
 * re-validate the chosen slot against live availability — but writes over the
 * existing booking instead of inserting, guarded so it only applies while the
 * booking is still pending. On success it moves the SAME calendar event (Meet
 * link, attendees, description preserved) and re-sends the confirmation.
 */
export async function confirmRescheduledSlot(input: {
  token: string;
  start_iso: string;
}): Promise<{ ok: true }> {
  let parsed;
  try {
    parsed = bookInterviewSlotSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues[0]?.message ?? "Invalid booking");
    }
    throw err;
  }

  const { application_id } = verifyResponseToken(parsed.token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "interview-reschedule-confirm", ...SCHEDULE_RATE_LIMIT });

  const ctx = await fetchSchedulingContext(application_id);
  if (!ctx) {
    throw new Error("This link is no longer active. Please contact the hiring team.");
  }

  const booking = await fetchBookingForApplication(application_id);
  if (!booking || booking.status !== BOOKING_STATUS_PENDING_RESCHEDULE) {
    throw new Error(
      "There's no time change in progress for this interview. Please refresh the page.",
    );
  }

  const { match, timezone } = await requireAvailableSlot(
    ctx,
    parsed.start_iso,
    `confirmRescheduledSlot ${application_id}`,
  );

  // Conditional re-book: only applies while still pending. A false return means
  // the booking already moved on (a concurrent confirm, or a fresh recruiter
  // edit landed first) — surface it rather than silently overwriting.
  const applied = await updateBooking({
    applicationId: application_id,
    scheduledAtIso: match.startIso,
    slotMinutes: ctx.slot_minutes,
    timezone,
  });
  if (!applied) {
    throw new Error("This booking has already changed. Please refresh and try again.");
  }

  // Best-effort third-party work after the response: move the SAME calendar
  // event and re-send the confirmation. Failures log, never surface.
  after(async () => {
    const db = createAdminClient();

    const googleEventId = await fetchBookingCalendarEventId(application_id, db).catch(() => null);
    const { meetUrl, eventId } = await updateBookingCalendarEvent({
      ownerUserId: ctx.owner_user_id,
      applicationId: application_id,
      googleEventId,
      candidateName: ctx.candidate_name,
      candidateEmail: ctx.candidate_email,
      campaignTitle: ctx.campaign_title,
      startIso: match.startIso,
      slotMinutes: ctx.slot_minutes,
      timeZone: timezone,
    });

    // The event id can change if we had to create a fresh event as a fallback.
    if (eventId && eventId !== googleEventId) {
      await setBookingCalendarEventId(application_id, eventId, db).catch((err) =>
        console.error(
          "Storing rescheduled calendar event id failed:",
          err instanceof Error ? err.message : err,
        ),
      );
    }

    try {
      const gmail = await getRecruiterGmailClient(ctx.owner_user_id, db);
      const email = buildInterviewConfirmationEmail({
        candidateName: ctx.candidate_name,
        campaignTitle: ctx.campaign_title,
        interviewAt: new Date(match.startIso),
        meetUrl: meetUrl ?? undefined,
      });
      await sendEmail(gmail, {
        to: ctx.candidate_email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      console.error(
        "Reschedule confirmation email failed:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return { ok: true };
}
