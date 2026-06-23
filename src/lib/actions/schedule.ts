"use server";

import { headers } from "next/headers";
import { z } from "zod/v4";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { bookInterviewSlotSchema, uuidSchema } from "@/lib/validations";
import {
  fetchSchedulingContext,
  fetchBookedSlotIsos,
  fetchBookingForApplication,
  fetchBookingForRecruiter,
  insertBooking,
  type InterviewBooking,
} from "@/lib/data/scheduling";
import { generateSlots, type GeneratedSlot } from "@/lib/scheduling/slots";
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
  /** Available slots to choose from (empty when already booked or unconfigured). */
  slots: GeneratedSlot[];
  timezone: string | null;
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
      timezone: ctx.timezone,
    };
  }

  // No availability configured → nothing to offer (page shows a notice).
  if (!ctx.timezone || ctx.availability_rules.length === 0) {
    return {
      campaign_title: ctx.campaign_title,
      booking: null,
      slots: [],
      timezone: ctx.timezone,
    };
  }

  const bookedIso = await fetchBookedSlotIsos(ctx.campaign_id);
  const slots = generateSlots({
    rules: ctx.availability_rules,
    slotMinutes: ctx.slot_minutes,
    timezone: ctx.timezone,
    horizonDays: ctx.booking_horizon_days,
    bookedIso,
  });

  return {
    campaign_title: ctx.campaign_title,
    booking: null,
    slots,
    timezone: ctx.timezone,
  };
}

/**
 * Books a slot for the candidate. Verifies the token + rate-limits, re-validates
 * the chosen slot against freshly generated availability (the server is the
 * source of truth), persists the booking, advances the application to
 * `interview_scheduled` via the system transition, and sends a confirmation
 * email from the campaign owner's inbox (best-effort).
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
  if (ctx.status !== "interview_scheduling") {
    throw new Error(
      "This interview is already scheduled or no longer open for booking.",
    );
  }
  if (!ctx.timezone || ctx.availability_rules.length === 0) {
    throw new Error("Interview scheduling isn't available for this role yet.");
  }

  // Re-validate the chosen slot server-side against current availability.
  const bookedIso = await fetchBookedSlotIsos(ctx.campaign_id);
  const slots = generateSlots({
    rules: ctx.availability_rules,
    slotMinutes: ctx.slot_minutes,
    timezone: ctx.timezone,
    horizonDays: ctx.booking_horizon_days,
    bookedIso,
  });
  const chosenMs = new Date(parsed.start_iso).getTime();
  const match = slots.find((s) => new Date(s.startIso).getTime() === chosenMs);
  if (!match) {
    throw new Error("That time isn't available. Please pick another slot.");
  }

  // Persist first (unique constraints are the race backstop), then advance.
  await insertBooking({
    applicationId: application_id,
    campaignId: ctx.campaign_id,
    scheduledAtIso: match.startIso,
    slotMinutes: ctx.slot_minutes,
    timezone: ctx.timezone,
  });

  await transitionApplicationAsSystem(
    application_id,
    "interview_scheduled",
    "Candidate booked an interview slot",
  );

  // Confirmation email from the campaign owner's inbox — never blocks the booking.
  try {
    const gmail = await getRecruiterGmailClient(ctx.owner_user_id);
    const email = buildInterviewConfirmationEmail({
      candidateName: ctx.candidate_name,
      campaignTitle: ctx.campaign_title,
      interviewAt: new Date(match.startIso),
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

  return { ok: true };
}
