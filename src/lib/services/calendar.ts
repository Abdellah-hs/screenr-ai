import { google, type calendar_v3 } from "googleapis";
import { createGoogleAuthClient } from "./gmail";
import { zonedWallTimeToUtc } from "@/lib/scheduling/slots";

/** A block of time the recruiter is busy, as UTC instants. */
export interface BusyInterval {
  startIso: string;
  endIso: string;
}

/**
 * Case-insensitive phrase an event title must contain to count as a bookable
 * "Interview hours" window. The manager's calendar is the availability
 * settings page: recurring events with this phrase in the title define when
 * candidates may book.
 */
export const INTERVIEW_HOURS_KEYWORD = "interview hours";

export interface CalendarSchedule {
  /** "Interview hours" blocks — the only windows candidates may book inside. */
  windows: BusyInterval[];
  /** Everything else that occupies the manager: meetings, OOO, focus time. */
  conflicts: BusyInterval[];
  /** The calendar's IANA timezone (used to label slots), if Google reports one. */
  timeZone: string | null;
}

function isInterviewHoursTitle(summary: string | null | undefined): boolean {
  return (summary ?? "").toLowerCase().includes(INTERVIEW_HOURS_KEYWORD);
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
 * Read the manager's primary calendar once and split it into the two things
 * candidate scheduling needs: the "Interview hours" windows they published,
 * and the conflicts that occupy them. One events.list call — deliberately NOT
 * the free/busy endpoint, because free/busy merges an hours block marked
 * "Busy" with the real meetings inside it into one opaque range.
 *
 * Classification per event (recurring events arrive pre-expanded):
 *   - title contains "interview hours" (any case) + concrete times → WINDOW
 *   - out-of-office → CONFLICT, even when all-day
 *   - marked Free (transparent), working-location/birthday markers, or
 *     declined by the manager → ignored
 *   - anything else with concrete times → CONFLICT; all-day only when Busy
 *
 * Server-side only: event titles are inspected to spot windows but never
 * persisted or shown to candidates. Errors propagate — the caller owns the
 * strict "can't read calendar → offer nothing" decision.
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
  const windows: BusyInterval[] = [];
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

    // A bookable window needs concrete times — an all-day "interview hours"
    // event is ambiguous, so it neither opens a window nor blocks the day.
    if (isInterviewHoursTitle(event.summary)) {
      if (timedSpan) windows.push(timedSpan);
      continue;
    }

    // Events marked Free don't occupy the manager, so they're skipped (and
    // it's why hours blocks are best marked Free — see the docstring).
    if (event.transparency === "transparent") continue;

    if (timedSpan) {
      conflicts.push(timedSpan);
    } else if (allDay) {
      // Ordinary all-day events default to Free and were skipped above; one
      // explicitly marked Busy blocks its whole day.
      conflicts.push(allDay);
    }
  }

  return { windows, conflicts, timeZone };
}

function createCalendarClient(refreshToken: string): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: createGoogleAuthClient(refreshToken) });
}

// NOTE: the earlier free/busy query (`fetchBusyIntervals`) was removed in
// favor of `fetchCalendarSchedule` above — free/busy merges an "Interview
// hours" block marked Busy with the meetings inside it, which made it unusable
// once availability itself moved into the calendar.

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

  const meetUrl =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ??
    data.hangoutLink ??
    null;

  return { eventId: data.id ?? null, meetUrl };
}
