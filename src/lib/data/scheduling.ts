import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { InterviewAvailabilityRule } from "@/lib/constants";
import type { SupabaseDb } from "@/lib/supabase/types";

/** Booking status literals (the column is plain text, so these are by convention). */
export const BOOKING_STATUS_BOOKED = "booked";
export const BOOKING_STATUS_PENDING_RESCHEDULE = "pending_reschedule";

/**
 * Scheduling data layer. The candidate-facing reads/writes use the service-role
 * admin client (candidates have no session, and the tables are owner-only RLS),
 * gated upstream by a verified scheduling token. The recruiter-facing read uses
 * the normal client under owner RLS.
 */

export interface SchedulingContext {
  application_id: string;
  campaign_id: string;
  campaign_title: string;
  owner_user_id: string;
  candidate_name: string;
  candidate_email: string;
  status: string;
  slot_minutes: number;
  timezone: string | null;
  booking_horizon_days: number;
  availability_rules: InterviewAvailabilityRule[];
}

export interface InterviewBooking {
  scheduled_at: string;
  slot_minutes: number;
  timezone: string;
  status: string;
}

/** Everything the candidate scheduling page needs, fetched via the admin client. */
export async function fetchSchedulingContext(
  applicationId: string,
): Promise<SchedulingContext | null> {
  const supabase = createAdminClient();

  const { data: app } = await supabase
    .from("applications")
    .select("id, campaign_id, candidate_id, status")
    .eq("id", applicationId)
    .single();
  if (!app) return null;

  const [{ data: campaign }, { data: candidate }, { data: rules }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "title, user_id, interview_slot_minutes, interview_timezone, interview_booking_horizon_days",
      )
      .eq("id", app.campaign_id)
      .single(),
    supabase
      .from("candidates")
      .select("first_name, last_name, email")
      .eq("id", app.candidate_id)
      .single(),
    supabase
      .from("interview_availability_rules")
      .select("weekday, start_minute, end_minute")
      .eq("campaign_id", app.campaign_id),
  ]);

  if (!campaign || !candidate) return null;

  return {
    application_id: app.id,
    campaign_id: app.campaign_id,
    campaign_title: campaign.title,
    owner_user_id: campaign.user_id,
    candidate_name: `${candidate.first_name} ${candidate.last_name}`,
    candidate_email: candidate.email,
    status: app.status,
    slot_minutes: campaign.interview_slot_minutes ?? 30,
    timezone: campaign.interview_timezone,
    booking_horizon_days: campaign.interview_booking_horizon_days ?? 14,
    availability_rules: (rules ?? []).map((r) => ({
      weekday: r.weekday,
      start_minute: r.start_minute,
      end_minute: r.end_minute,
    })),
  };
}

/** Booked slot start instants (ISO) for a campaign — the "taken" set. */
export async function fetchBookedSlotIsos(campaignId: string): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("interview_bookings")
    .select("scheduled_at")
    .eq("campaign_id", campaignId)
    .eq("status", "booked");
  return (data ?? []).map((r) => new Date(r.scheduled_at).toISOString());
}

/** The booking for an application, if any (candidate-side, admin client). */
export async function fetchBookingForApplication(
  applicationId: string,
): Promise<InterviewBooking | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("interview_bookings")
    .select("scheduled_at, slot_minutes, timezone, status")
    .eq("application_id", applicationId)
    .maybeSingle();
  return data ?? null;
}

export class SlotTakenError extends Error {
  constructor() {
    super("That time was just taken. Please pick another slot.");
    this.name = "SlotTakenError";
  }
}

/**
 * Persist a booking via the admin client. The DB unique constraints
 * (application_id, and campaign_id+scheduled_at) are the race backstop:
 * a conflict means the candidate already booked or the slot was just taken.
 */
export async function insertBooking(params: {
  applicationId: string;
  campaignId: string;
  scheduledAtIso: string;
  slotMinutes: number;
  timezone: string;
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("interview_bookings").insert({
    application_id: params.applicationId,
    campaign_id: params.campaignId,
    scheduled_at: params.scheduledAtIso,
    slot_minutes: params.slotMinutes,
    timezone: params.timezone,
    status: "booked",
  });

  if (error) {
    if (error.code === "23505") throw new SlotTakenError();
    throw new Error(`Failed to save booking: ${error.message}`);
  }
}

/** Recruiter-facing read of a booking, under owner RLS (normal client). */
export async function fetchBookingForRecruiter(
  applicationId: string,
): Promise<InterviewBooking | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("interview_bookings")
    .select("scheduled_at, slot_minutes, timezone, status")
    .eq("application_id", applicationId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Persist the Google Calendar event id on a booking, once the event has been
 * created (or moved) — the link reconciliation needs to map a changed calendar
 * event back to its booking. Runs after the booking row already exists.
 */
export async function setBookingCalendarEventId(
  applicationId: string,
  eventId: string,
  db?: SupabaseDb,
): Promise<void> {
  const supabase = db ?? createAdminClient();
  const { error } = await supabase
    .from("interview_bookings")
    .update({ google_event_id: eventId })
    .eq("application_id", applicationId);
  if (error) throw new Error(`Failed to store calendar event id: ${error.message}`);
}

/** The stored Google Calendar event id for an application's booking, if any. */
export async function fetchBookingCalendarEventId(
  applicationId: string,
  db?: SupabaseDb,
): Promise<string | null> {
  const supabase = db ?? createAdminClient();
  const { data } = await supabase
    .from("interview_bookings")
    .select("google_event_id")
    .eq("application_id", applicationId)
    .maybeSingle();
  return data?.google_event_id ?? null;
}

/** A booking matched by its Google Calendar event id (reconciliation lookup). */
export interface BookingByEvent {
  application_id: string;
  scheduled_at: string;
  status: string;
}

/**
 * Find the booking a changed Google Calendar event maps to. Returns null when
 * the event isn't one of ours (the recruiter edited some unrelated meeting).
 */
export async function fetchBookingByGoogleEventId(
  eventId: string,
  db?: SupabaseDb,
): Promise<BookingByEvent | null> {
  const supabase = db ?? createAdminClient();
  const { data } = await supabase
    .from("interview_bookings")
    .select("application_id, scheduled_at, status")
    .eq("google_event_id", eventId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Flip a booking `booked` → `pending_reschedule`, conditionally: the update
 * only matches a row still in `booked`, so overlapping/duplicate webhook
 * deliveries can cause at most ONE transition. Returns true when THIS call
 * caused the flip (a row matched) — the caller uses that to fire exactly one
 * "please re-pick" email and skip it on the duplicates.
 */
export async function markBookingPendingReschedule(
  applicationId: string,
  db?: SupabaseDb,
): Promise<boolean> {
  const supabase = db ?? createAdminClient();
  const { data, error } = await supabase
    .from("interview_bookings")
    .update({ status: BOOKING_STATUS_PENDING_RESCHEDULE })
    .eq("application_id", applicationId)
    .eq("status", BOOKING_STATUS_BOOKED)
    .select("id");
  if (error) throw new Error(`Failed to mark booking pending: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Re-confirm a reschedule: write the candidate's newly chosen time and flip the
 * booking back to `booked`, conditionally on it still being
 * `pending_reschedule`. Returns true when a row matched — false means the
 * booking already moved on (a concurrent confirm, or a fresh recruiter edit
 * landed first), which the caller must surface rather than apply a stale write.
 * The `UNIQUE(campaign_id, scheduled_at)` constraint still guards against two
 * candidates landing on the same slot (surfaced as `SlotTakenError`).
 */
export async function updateBooking(params: {
  applicationId: string;
  scheduledAtIso: string;
  slotMinutes: number;
  timezone: string;
  db?: SupabaseDb;
}): Promise<boolean> {
  const supabase = params.db ?? createAdminClient();
  const { data, error } = await supabase
    .from("interview_bookings")
    .update({
      scheduled_at: params.scheduledAtIso,
      slot_minutes: params.slotMinutes,
      timezone: params.timezone,
      status: BOOKING_STATUS_BOOKED,
    })
    .eq("application_id", params.applicationId)
    .eq("status", BOOKING_STATUS_PENDING_RESCHEDULE)
    .select("id");

  if (error) {
    if (error.code === "23505") throw new SlotTakenError();
    throw new Error(`Failed to update booking: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
