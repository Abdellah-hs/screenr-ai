import { google, type calendar_v3 } from "googleapis";
import { createGoogleAuthClient } from "./gmail";
import { zonedWallTimeToUtc } from "@/lib/scheduling/slots";

/** A block of time the recruiter is busy, as UTC instants. */
export interface BusyInterval {
  startIso: string;
  endIso: string;
}

export interface CalendarSchedule {
  /** Everything that occupies the manager: meetings, OOO, focus time. */
  conflicts: BusyInterval[];
  /** The calendar's IANA timezone (used to label slots), if Google reports one. */
  timeZone: string | null;
}

/** The owner declined this meeting, so it doesn't occupy them. */
function ownerDeclined(event: calendar_v3.Schema$Event): boolean {
  return (event.attendees ?? []).some(
    (a) => a.self === true && a.responseStatus === "declined",
  );
}

/**
 * UTC span of an all-day (date-only) event: local midnight to local midnight
 * in the calendar's timezone. Falls back to UTC when Google reports no tz.
 */
function allDaySpan(
  startDate: string,
  endDateExclusive: string,
  timeZone: string | null,
): BusyInterval {
  const tz = timeZone ?? "UTC";
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDateExclusive.split("-").map(Number);
  return {
    startIso: zonedWallTimeToUtc(sy, sm, sd, 0, tz).toISOString(),
    endIso: zonedWallTimeToUtc(ey, em, ed, 0, tz).toISOString(),
  };
}

/**
 * Read the manager's primary calendar once and return every conflict that
 * occupies them — bookable time is no longer calendar-marked (see
 * `generateBusinessHourWindows` in `@/lib/scheduling/slots`, which supplies a
 * fixed 9am-6pm weekday window instead); this is purely "what's busy". One
 * events.list call — deliberately NOT the free/busy endpoint, since free/busy
 * merges distinct events into opaque ranges and loses the per-event detail
 * (transparency, declined status, event type) the classification below needs.
 *
 * Classification per event (recurring events arrive pre-expanded):
 *   - out-of-office → CONFLICT, even when all-day
 *   - marked Free (transparent), working-location/birthday markers, or
 *     declined by the manager → ignored
 *   - anything else with concrete times → CONFLICT; all-day only when Busy
 *
 * Errors propagate — the caller owns the strict "can't read calendar → offer
 * nothing" decision.
 */
export async function fetchCalendarSchedule(params: {
  refreshToken: string;
  /** Window start, inclusive (ISO instant). */
  timeMinIso: string;
  /** Window end, exclusive (ISO instant). */
  timeMaxIso: string;
}): Promise<CalendarSchedule> {
  const calendar = createCalendarClient(params.refreshToken);

  // A booking horizon is ~2 weeks, so one page is far more than enough;
  // pagination is intentionally not implemented.
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: params.timeMinIso,
    timeMax: params.timeMaxIso,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const timeZone = data.timeZone ?? null;
  const conflicts: BusyInterval[] = [];

  for (const event of data.items ?? []) {
    if (event.status === "cancelled") continue;
    if (event.eventType === "workingLocation" || event.eventType === "birthday") continue;
    if (ownerDeclined(event)) continue;

    const startDt = event.start?.dateTime;
    const endDt = event.end?.dateTime;
    const startDate = event.start?.date;
    const endDate = event.end?.date;
    const timedSpan =
      startDt && endDt
        ? { startIso: new Date(startDt).toISOString(), endIso: new Date(endDt).toISOString() }
        : null;
    const allDay = startDate && endDate ? allDaySpan(startDate, endDate, timeZone) : null;

    // Out-of-office always occupies the manager — vacations are often all-day.
    if (event.eventType === "outOfOffice") {
      if (timedSpan) conflicts.push(timedSpan);
      else if (allDay) conflicts.push(allDay);
      continue;
    }

    // Events marked Free don't occupy the manager, so they're skipped.
    if (event.transparency === "transparent") continue;

    if (timedSpan) {
      conflicts.push(timedSpan);
    } else if (allDay) {
      // Ordinary all-day events default to Free and were skipped above; one
      // explicitly marked Busy blocks its whole day.
      conflicts.push(allDay);
    }
  }

  return { conflicts, timeZone };
}

function createCalendarClient(refreshToken: string): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: createGoogleAuthClient(refreshToken) });
}

// NOTE: the earlier free/busy query (`fetchBusyIntervals`) was removed in
// favor of `fetchCalendarSchedule` above — free/busy merges distinct events
// into one opaque busy range, which loses the per-event detail (transparency,
// declined status, event type) needed to classify conflicts correctly.

export interface CreatedInterviewEvent {
  eventId: string | null;
  /** "Join with Google Meet" URL, when Google attached one. */
  meetUrl: string | null;
}

/**
 * Create the final-interview event on the manager's primary calendar with the
 * candidate invited as guest and a Google Meet room attached. `sendUpdates:
 * "all"` makes Google email the candidate a real calendar invite, so the
 * meeting lands in both calendars with a join button. Requires the
 * `calendar.events` scope. Errors propagate — the caller treats event
 * creation as best-effort (a booking must never be undone by a Google
 * hiccup).
 */
export async function createInterviewEvent(params: {
  refreshToken: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  /** IANA timezone the event is anchored to (candidate + manager display). */
  timeZone: string;
  candidateEmail: string;
  candidateName: string;
  /**
   * Unique id for the Meet-room creation request (Google dedupes on it);
   * reusing the application id makes retries idempotent.
   */
  requestId: string;
}): Promise<CreatedInterviewEvent> {
  const calendar = createCalendarClient(params.refreshToken);

  const { data } = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startIso, timeZone: params.timeZone },
      end: { dateTime: params.endIso, timeZone: params.timeZone },
      attendees: [
        { email: params.candidateEmail, displayName: params.candidateName },
      ],
      conferenceData: {
        createRequest: {
          requestId: params.requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  return { eventId: data.id ?? null, meetUrl: extractMeetUrl(data) };
}

/** Pull the "Join with Google Meet" URL off an event, if Google attached one. */
function extractMeetUrl(event: calendar_v3.Schema$Event): string | null {
  return (
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ??
    event.hangoutLink ??
    null
  );
}

/**
 * Move an existing interview event to a new time, in place. Uses `patch` (a
 * partial merge) deliberately: the body carries only `start`/`end`, so the
 * candidate stays invited and the description and Google Meet room survive
 * untouched — no need to resend them. `sendUpdates: "all"` makes Google notify
 * both the organizer and the candidate of the change, exactly as it would for a
 * manually edited meeting. Errors propagate — the caller decides the fallback.
 */
export async function updateInterviewEvent(params: {
  refreshToken: string;
  eventId: string;
  startIso: string;
  endIso: string;
  /** IANA timezone the event is anchored to. */
  timeZone: string;
}): Promise<CreatedInterviewEvent> {
  const calendar = createCalendarClient(params.refreshToken);

  const { data } = await calendar.events.patch({
    calendarId: "primary",
    eventId: params.eventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: params.startIso, timeZone: params.timeZone },
      end: { dateTime: params.endIso, timeZone: params.timeZone },
    },
  });

  return { eventId: data.id ?? null, meetUrl: extractMeetUrl(data) };
}

export interface CalendarWatchChannel {
  /** Google's opaque id for the watched resource — needed to stop the channel. */
  resourceId: string | null;
  /** Channel expiry (ISO instant), when Google reports one. */
  expirationIso: string | null;
}

/**
 * Open a Google `events.watch` channel on the manager's primary calendar, so
 * Google POSTs our webhook whenever an event changes. `channelId` and
 * `channelToken` are ours (we generate them); Google echoes the token back in
 * every notification's `X-Goog-Channel-Token` header, which the webhook
 * verifies. The default channel TTL is ~7 days, so a renewal job must re-watch
 * before `expiration`. Requires the `calendar.events` scope. Errors propagate.
 */
export async function watchCalendarEvents(params: {
  refreshToken: string;
  /** HTTPS webhook URL Google will POST change notifications to. */
  address: string;
  channelId: string;
  channelToken: string;
}): Promise<CalendarWatchChannel> {
  const calendar = createCalendarClient(params.refreshToken);

  const { data } = await calendar.events.watch({
    calendarId: "primary",
    requestBody: {
      id: params.channelId,
      type: "web_hook",
      address: params.address,
      token: params.channelToken,
    },
  });

  return {
    resourceId: data.resourceId ?? null,
    // Google returns expiration as unix-ms in a string; normalize to an ISO instant.
    expirationIso: data.expiration
      ? new Date(Number(data.expiration)).toISOString()
      : null,
  };
}

/** Stop a previously opened watch channel (best-effort; errors propagate). */
export async function stopCalendarWatch(params: {
  refreshToken: string;
  channelId: string;
  resourceId: string;
}): Promise<void> {
  const calendar = createCalendarClient(params.refreshToken);
  await calendar.channels.stop({
    requestBody: { id: params.channelId, resourceId: params.resourceId },
  });
}

/** A calendar event that changed since the last sync, in the shape we consume. */
export interface ChangedCalendarEvent {
  eventId: string | null;
  /** UTC instant of the (new) start, or null for all-day / cancelled events. */
  startIso: string | null;
  /** Google's event status — "cancelled" means deleted. */
  status: string | null;
}

export interface ChangedCalendarEvents {
  events: ChangedCalendarEvent[];
  /** Cursor to persist for the next incremental sync. */
  nextSyncToken: string | null;
}

/**
 * Thrown when Google rejects a stored `syncToken` as stale/invalid (HTTP 410).
 * The caller must drop the token and re-run a bounded full sync — retrying the
 * same token would just fail again.
 */
export class SyncTokenExpiredError extends Error {
  constructor() {
    super("Calendar sync token expired; a full resync is required");
    this.name = "SyncTokenExpiredError";
  }
}

/**
 * List the events that changed on the manager's primary calendar since the
 * given `syncToken` (incremental sync), or — when no token is passed — since
 * `timeMinIso` (a bounded full sync, used to seed or recover the cursor).
 *
 * Paginates internally: Google returns `nextSyncToken` ONLY on the final page,
 * so we accumulate items across every page and read the token off the last one.
 * Persisting an intermediate page's (absent) token would silently corrupt the
 * next sync. A 410 from an expired token is surfaced as `SyncTokenExpiredError`.
 */
export async function listChangedCalendarEvents(params: {
  refreshToken: string;
  syncToken?: string | null;
  /** Lower bound for the full-sync fallback (ignored when syncToken is set). */
  timeMinIso?: string;
}): Promise<ChangedCalendarEvents> {
  const calendar = createCalendarClient(params.refreshToken);

  const events: ChangedCalendarEvent[] = [];
  let pageToken: string | undefined = undefined;
  let nextSyncToken: string | null = null;

  try {
    do {
      const { data }: { data: calendar_v3.Schema$Events } =
        await calendar.events.list({
          calendarId: "primary",
          singleEvents: true,
          pageToken,
          // syncToken and timeMin are mutually exclusive; prefer the cursor.
          ...(params.syncToken
            ? { syncToken: params.syncToken }
            : { timeMin: params.timeMinIso }),
        });

      for (const event of data.items ?? []) {
        events.push({
          eventId: event.id ?? null,
          startIso: event.start?.dateTime
            ? new Date(event.start.dateTime).toISOString()
            : null,
          status: event.status ?? null,
        });
      }

      pageToken = data.nextPageToken ?? undefined;
      // Only the final page carries the sync token.
      if (!pageToken) nextSyncToken = data.nextSyncToken ?? null;
    } while (pageToken);
  } catch (err) {
    if (isGoneError(err)) throw new SyncTokenExpiredError();
    throw err;
  }

  return { events, nextSyncToken };
}

/** Whether a googleapis error is an HTTP 410 Gone (stale sync token). */
function isGoneError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown; status?: unknown }).code;
  const status = (err as { status?: unknown }).status;
  return code === 410 || status === 410;
}
