import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { hasCalendarScopes } from "@/lib/services/gmail";
import {
  fetchCalendarSchedule,
  type CalendarSchedule,
} from "@/lib/services/calendar";

export type OwnerSchedule =
  | ({ available: true } & CalendarSchedule)
  | {
      available: false;
      reason: "not_connected" | "calendar_not_granted" | "lookup_failed";
    };

/**
 * The campaign owner's published "Interview hours" windows and conflicting
 * events over the booking window, for the candidate scheduling flow. STRICT
 * by product decision (2026-07-08): when the owner's calendar cannot be
 * consulted — no Google connection, calendar scopes not granted yet, or the
 * lookup failed — the caller must offer NO slots and reject bookings, rather
 * than fall back to anything configured in-app. A candidate must never book
 * a time the interviewer might not be free.
 *
 * Runs on the admin client: the callers are candidate-facing (token-gated,
 * no recruiter session).
 */
export async function fetchOwnerSchedule(params: {
  ownerUserId: string;
  horizonDays: number;
  /** "Now" — injectable for tests. Defaults to the current time. */
  now?: Date;
}): Promise<OwnerSchedule> {
  const { ownerUserId, horizonDays, now = new Date() } = params;

  const connection = await fetchGmailConnection(ownerUserId, createAdminClient());
  if (!connection) return { available: false, reason: "not_connected" };
  if (!hasCalendarScopes(connection.scope)) {
    return { available: false, reason: "calendar_not_granted" };
  }

  // Slot generation walks whole calendar days in the display timezone, so the
  // last offered slot can land past now + horizonDays*24h. Pad the read window
  // by two days so no offered slot escapes the conflict check.
  const timeMax = new Date(now.getTime() + (horizonDays + 2) * 24 * 60 * 60 * 1000);

  try {
    const schedule = await fetchCalendarSchedule({
      refreshToken: connection.refresh_token,
      timeMinIso: now.toISOString(),
      timeMaxIso: timeMax.toISOString(),
    });
    return { available: true, ...schedule };
  } catch (err) {
    console.error(
      `fetchOwnerSchedule: calendar read failed for owner ${ownerUserId}:`,
      err instanceof Error ? err.message : err,
    );
    return { available: false, reason: "lookup_failed" };
  }
}
