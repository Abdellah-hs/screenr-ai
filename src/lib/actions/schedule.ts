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
  insertBooking,
  type InterviewBooking,
} from "@/lib/data/scheduling";
import {
  pickRecommendedSlots,
  type GeneratedSlot,
} from "@/lib/scheduling/slots";
import { resolveAvailableSlots } from "@/lib/scheduling/available-slots";
import { createBookingCalendarEvent } from "@/lib/scheduling/booking-event";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";
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
  /** The candidate's existing booking, if they've already scheduled. */
  booking: InterviewBooking | null;
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
   * The calendar was read fine but the interviewer has published no
   * "Interview hours" blocks in it — nothing is bookable until they do.
   */
  no_hours: boolean;
}

/**
 * Loads the candidate scheduling page (token-gated, read-only). Verifies the
 * token, then either returns the existing booking (confirmation state) or the
 * currently-available slots generated from the campaign's availability.
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
  if (booking && booking.status === "booked") {
    return {
      campaign_title: ctx.campaign_title,
      booking,
      slots: [],
      recommended_iso: [],
      timezone: ctx.timezone,
      calendar_unavailable: false,
      no_hours: false,
    };
  }

  // Strict calendar gate: no consultable calendar → no slots at all.
  const resolved = await resolveAvailableSlots(ctx);
  if (resolved.status === "calendar_unavailable") {
    console.warn(
      `loadSchedulingContext: calendar unavailable (${resolved.reason}) for application ${application_id}`,
    );
    return {
      campaign_title: ctx.campaign_title,
      booking: null,
      slots: [],
      recommended_iso: [],
      timezone: ctx.timezone,
      calendar_unavailable: true,
      no_hours: false,
    };
  }

  // Calendar read fine, but the interviewer hasn't published hours blocks.
  if (resolved.status === "no_hours") {
    return {
      campaign_title: ctx.campaign_title,
      booking: null,
      slots: [],
      recommended_iso: [],
      timezone: resolved.timezone,
      calendar_unavailable: false,
      no_hours: true,
    };
  }

  return {
    campaign_title: ctx.campaign_title,
    booking: null,
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
  const resolved = await resolveAvailableSlots(ctx);
  if (resolved.status === "calendar_unavailable") {
    console.warn(
      `bookInterviewSlot: calendar unavailable (${resolved.reason}) for application ${application_id}`,
    );
    throw new Error(
      "Booking is temporarily unavailable. Please try again shortly, or contact the hiring team.",
    );
  }
  if (resolved.status === "no_hours") {
    throw new Error(
      "Interview times aren't open for this role yet. Please contact the hiring team.",
    );
  }

  const timezone = resolved.timezone;
  const chosenMs = new Date(parsed.start_iso).getTime();
  const match = resolved.slots.find(
    (s) => new Date(s.startIso).getTime() === chosenMs,
  );
  if (!match) {
    throw new Error("That time isn't available. Please pick another slot.");
  }

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

  // The booking is durable — everything below is slow third-party work
  // (Google Calendar event + Meet room, confirmation email), so it runs AFTER
  // the response and the candidate sees their confirmation instantly. Both
  // steps are best-effort; failures log and never surface to the candidate.
  after(async () => {
    const { meetUrl } = await createBookingCalendarEvent({
      ownerUserId: ctx.owner_user_id,
      applicationId: application_id,
      candidateName: ctx.candidate_name,
      candidateEmail: ctx.candidate_email,
      campaignTitle: ctx.campaign_title,
      startIso: match.startIso,
      slotMinutes: ctx.slot_minutes,
      timeZone: timezone,
    });

    try {
      // Admin db: this is a candidate request — there is no recruiter session,
      // so the cookie client would hit owner-only RLS and find no connection.
      const gmail = await getRecruiterGmailClient(ctx.owner_user_id, createAdminClient());
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
