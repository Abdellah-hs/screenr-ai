import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { hasCalendarScopes } from "@/lib/services/gmail";
import { createInterviewEvent } from "@/lib/services/calendar";

/**
 * Put a confirmed booking on the campaign owner's Google Calendar: an event
 * for the slot, the candidate invited as guest, and a Google Meet room
 * attached (Google also emails the candidate a calendar invite). Returns the
 * Meet URL for the confirmation email, or null when no event was created.
 *
 * Strictly best-effort — the booking row is already durable, so nothing here
 * throws: a missing connection, missing scopes (races the reconnect), or a
 * Google failure is logged and reported as null. The recruiter can add the
 * event by hand from the booked banner if that ever happens.
 */
export async function createBookingCalendarEvent(params: {
  ownerUserId: string;
  applicationId: string;
  candidateName: string;
  candidateEmail: string;
  campaignTitle: string;
  startIso: string;
  slotMinutes: number;
  timeZone: string;
}): Promise<{ meetUrl: string | null }> {
  try {
    const connection = await fetchGmailConnection(
      params.ownerUserId,
      createAdminClient(),
    );
    if (!connection || !hasCalendarScopes(connection.scope)) {
      console.warn(
        `createBookingCalendarEvent: no calendar-enabled connection for owner ${params.ownerUserId} — event skipped`,
      );
      return { meetUrl: null };
    }

    const endIso = new Date(
      new Date(params.startIso).getTime() + params.slotMinutes * 60_000,
    ).toISOString();

    const event = await createInterviewEvent({
      refreshToken: connection.refresh_token,
      summary: `Final interview: ${params.candidateName} — ${params.campaignTitle}`,
      description:
        "Final interview scheduled by the candidate via Screenr AI. " +
        "Rescheduling: reply to the candidate's confirmation email thread.",
      startIso: params.startIso,
      endIso,
      timeZone: params.timeZone,
      candidateEmail: params.candidateEmail,
      candidateName: params.candidateName,
      requestId: params.applicationId,
    });

    return { meetUrl: event.meetUrl };
  } catch (err) {
    console.error(
      `createBookingCalendarEvent: event creation failed for application ${params.applicationId}:`,
      err instanceof Error ? err.message : err,
    );
    return { meetUrl: null };
  }
}
