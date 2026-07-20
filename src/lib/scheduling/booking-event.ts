import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { hasCalendarScopes } from "@/lib/services/gmail";
import { createInterviewEvent, updateInterviewEvent } from "@/lib/services/calendar";

const EVENT_DESCRIPTION =
  "Final interview scheduled via Screenr AI. To change the time, edit this " +
  "event in your calendar — the candidate will be asked to pick a new slot.";

/** Outcome of a calendar-event write: the Meet link (for email) + the event id. */
export interface BookingEventResult {
  meetUrl: string | null;
  /** Google's event id — persisted so a later reschedule can move THIS event. */
  eventId: string | null;
}

function eventSummary(candidateName: string, campaignTitle: string): string {
  return `Final interview: ${candidateName} — ${campaignTitle}`;
}

function endIsoFrom(startIso: string, slotMinutes: number): string {
  return new Date(new Date(startIso).getTime() + slotMinutes * 60_000).toISOString();
}

/**
 * Put a confirmed booking on the campaign owner's Google Calendar: an event for
 * the slot, the candidate invited as guest, and a Google Meet room attached
 * (Google also emails the candidate a calendar invite). Returns the Meet URL and
 * the event id (persist the latter so a reschedule can move the same event).
 *
 * Strictly best-effort — the booking row is already durable, so nothing here
 * throws: a missing connection, missing scopes (races the reconnect), or a
 * Google failure is logged and reported as nulls. The recruiter can add the
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
}): Promise<BookingEventResult> {
  try {
    const connection = await fetchGmailConnection(
      params.ownerUserId,
      createAdminClient(),
    );
    if (!connection || !hasCalendarScopes(connection.scope)) {
      console.warn(
        `createBookingCalendarEvent: no calendar-enabled connection for owner ${params.ownerUserId} — event skipped`,
      );
      return { meetUrl: null, eventId: null };
    }

    const event = await createInterviewEvent({
      refreshToken: connection.refresh_token,
      summary: eventSummary(params.candidateName, params.campaignTitle),
      description: EVENT_DESCRIPTION,
      startIso: params.startIso,
      endIso: endIsoFrom(params.startIso, params.slotMinutes),
      timeZone: params.timeZone,
      candidateEmail: params.candidateEmail,
      candidateName: params.candidateName,
      requestId: params.applicationId,
    });

    return { meetUrl: event.meetUrl, eventId: event.eventId };
  } catch (err) {
    console.error(
      `createBookingCalendarEvent: event creation failed for application ${params.applicationId}:`,
      err instanceof Error ? err.message : err,
    );
    return { meetUrl: null, eventId: null };
  }
}

/**
 * Move the candidate's calendar event to a re-confirmed time. Patches the
 * existing event in place (same event id, same Meet link, candidate stays
 * invited) when we have its id; if the patch fails — or no id was stored (e.g.
 * the recruiter had no calendar connection at the original booking) — falls
 * back to creating a fresh event so the candidate still gets a real invite.
 *
 * Same best-effort contract as `createBookingCalendarEvent`: never throws;
 * returns nulls if even the fallback insert can't run.
 */
export async function updateBookingCalendarEvent(params: {
  ownerUserId: string;
  applicationId: string;
  googleEventId: string | null;
  candidateName: string;
  candidateEmail: string;
  campaignTitle: string;
  startIso: string;
  slotMinutes: number;
  timeZone: string;
}): Promise<BookingEventResult> {
  try {
    const connection = await fetchGmailConnection(
      params.ownerUserId,
      createAdminClient(),
    );
    if (!connection || !hasCalendarScopes(connection.scope)) {
      console.warn(
        `updateBookingCalendarEvent: no calendar-enabled connection for owner ${params.ownerUserId} — event skipped`,
      );
      return { meetUrl: null, eventId: null };
    }

    const endIso = endIsoFrom(params.startIso, params.slotMinutes);

    if (params.googleEventId) {
      try {
        const moved = await updateInterviewEvent({
          refreshToken: connection.refresh_token,
          eventId: params.googleEventId,
          startIso: params.startIso,
          endIso,
          timeZone: params.timeZone,
        });
        return { meetUrl: moved.meetUrl, eventId: moved.eventId };
      } catch (err) {
        // Patch failed (event deleted, id stale, …) — fall through to a fresh insert.
        console.warn(
          `updateBookingCalendarEvent: patch failed for application ${params.applicationId}, creating a new event:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const created = await createInterviewEvent({
      refreshToken: connection.refresh_token,
      summary: eventSummary(params.candidateName, params.campaignTitle),
      description: EVENT_DESCRIPTION,
      startIso: params.startIso,
      endIso,
      timeZone: params.timeZone,
      candidateEmail: params.candidateEmail,
      candidateName: params.candidateName,
      requestId: params.applicationId,
    });
    return { meetUrl: created.meetUrl, eventId: created.eventId };
  } catch (err) {
    console.error(
      `updateBookingCalendarEvent: event update failed for application ${params.applicationId}:`,
      err instanceof Error ? err.message : err,
    );
    return { meetUrl: null, eventId: null };
  }
}
