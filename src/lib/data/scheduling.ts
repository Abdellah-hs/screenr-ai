import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { InterviewAvailabilityRule } from "@/lib/constants";
import type { InterviewReminderKind } from "@/lib/rules/interview-reminders";
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
 * Persist what Google handed back for a booking: the event id (so a later
 * reschedule moves THAT event) and the Meet join link.
 *
 * The Meet link used to exist only inside the request that created the event,
 * long enough to go into the confirmation email and then be forgotten — which
 * left the reminder emails with no way to say "join here", the one line a
 * candidate actually needs an hour before the call.
 *
 * `meetUrl` is written only when present, so a reschedule that failed to re-read
 * the link can never blank out a good one.
 */
export async function setBookingCalendarLink(params: {
  applicationId: string;
  eventId: string;
  meetUrl?: string | null;
  db?: SupabaseDb;
}): Promise<void> {
  const supabase = params.db ?? createAdminClient();
  const { error } = await supabase
    .from("interview_bookings")
    .update({
      google_event_id: params.eventId,
      ...(params.meetUrl ? { meet_url: params.meetUrl } : {}),
    })
    .eq("application_id", params.applicationId);
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
      // A new time is a new thing to be reminded about. Carrying the old stamps
      // over would silently cancel every reminder for the rescheduled interview.
      reminder_24h_sent_at: null,
      reminder_1h_sent_at: null,
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

// The generated row types don't model embedded selects ergonomically; the rest
// of the data layer uses the same escape hatch for join-shaped query chains.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const REMINDER_COLUMN: Record<
  InterviewReminderKind,
  "reminder_24h_sent_at" | "reminder_1h_sent_at"
> = {
  "24h": "reminder_24h_sent_at",
  "1h": "reminder_1h_sent_at",
};

/** A booking near enough to its start time that a reminder may be owed. */
export interface ReminderWindowBooking {
  application_id: string;
  campaign_id: string;
  scheduled_at: string;
  created_at: string;
  status: string;
  timezone: string;
  meet_url: string | null;
  reminder_24h_sent_at: string | null;
  reminder_1h_sent_at: string | null;
  campaign_title: string;
  owner_user_id: string;
  /** Application state — a candidate closed out after booking gets nothing. */
  application_status: string;
  candidate_name: string;
  candidate_email: string;
}

/**
 * Every still-booked interview starting inside `windowMs`, with the campaign,
 * owner and candidate an email needs — one query, so the sweep does not fan out
 * into per-booking lookups.
 *
 * Rows where BOTH reminders already went out are excluded, so a sweep run over
 * a settled day reads almost nothing.
 */
export async function fetchBookingsInReminderWindow(
  now: Date,
  windowMs: number,
  db?: SupabaseDb,
): Promise<ReminderWindowBooking[]> {
  const supabase = (db ?? createAdminClient()) as AnyDb;

  const { data, error } = await supabase
    .from("interview_bookings")
    .select(
      `application_id, campaign_id, scheduled_at, created_at, status, timezone, meet_url,
       reminder_24h_sent_at, reminder_1h_sent_at,
       campaigns!inner ( title, user_id ),
       applications!inner ( status, candidates!inner ( first_name, last_name, email ) )`,
    )
    .eq("status", BOOKING_STATUS_BOOKED)
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", new Date(now.getTime() + windowMs).toISOString())
    .or("reminder_24h_sent_at.is.null,reminder_1h_sent_at.is.null");

  if (error) {
    throw new Error(
      `Failed to load bookings due for a reminder: ${error.message ?? JSON.stringify(error)}`,
    );
  }

  return (data ?? []).map((row: AnyDb) => ({
    application_id: row.application_id,
    campaign_id: row.campaign_id,
    scheduled_at: row.scheduled_at,
    created_at: row.created_at,
    status: row.status,
    timezone: row.timezone,
    meet_url: row.meet_url ?? null,
    reminder_24h_sent_at: row.reminder_24h_sent_at ?? null,
    reminder_1h_sent_at: row.reminder_1h_sent_at ?? null,
    campaign_title: row.campaigns?.title ?? "",
    owner_user_id: row.campaigns?.user_id ?? "",
    application_status: row.applications?.status ?? "",
    candidate_name:
      `${row.applications?.candidates?.first_name ?? ""} ${row.applications?.candidates?.last_name ?? ""}`.trim(),
    candidate_email: row.applications?.candidates?.email ?? "",
  }));
}

/**
 * Take ownership of one reminder before sending it.
 *
 * The stamp is written conditionally on it still being null, so of two
 * overlapping sweep runs exactly one can match the row — the other sees no
 * match and sends nothing. Claiming BEFORE the send is deliberate: an email is
 * not revocable, so the ordering has to make a double-send impossible rather
 * than merely unlikely. Returns true when this caller won the claim.
 */
export async function claimInterviewReminder(params: {
  applicationId: string;
  kind: InterviewReminderKind;
  at: Date;
  db?: SupabaseDb;
}): Promise<boolean> {
  const supabase = params.db ?? createAdminClient();
  const column = REMINDER_COLUMN[params.kind];

  const { data, error } = await supabase
    .from("interview_bookings")
    .update({ [column]: params.at.toISOString() })
    .eq("application_id", params.applicationId)
    .is(column, null)
    .select("id");

  if (error) throw new Error(`Failed to claim ${params.kind} reminder: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Hand a claim back after the send failed, so the next run retries instead of
 * the candidate silently losing their reminder. The narrow risk this accepts is
 * a send that actually landed but reported failure — one duplicate email, which
 * is the cheaper of the two mistakes.
 */
export async function releaseInterviewReminder(params: {
  applicationId: string;
  kind: InterviewReminderKind;
  db?: SupabaseDb;
}): Promise<void> {
  const supabase = params.db ?? createAdminClient();
  const { error } = await supabase
    .from("interview_bookings")
    .update({ [REMINDER_COLUMN[params.kind]]: null })
    .eq("application_id", params.applicationId);

  if (error) {
    throw new Error(`Failed to release ${params.kind} reminder: ${error.message}`);
  }
}
