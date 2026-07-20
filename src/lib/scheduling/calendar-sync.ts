import { randomUUID } from "crypto";
import type { SupabaseDb } from "@/lib/supabase/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { hasCalendarScopes } from "@/lib/services/gmail";
import {
  listChangedCalendarEvents,
  stopCalendarWatch,
  watchCalendarEvents,
  SyncTokenExpiredError,
} from "@/lib/services/calendar";
import {
  fetchBookingByGoogleEventId,
  markBookingPendingReschedule,
} from "@/lib/data/scheduling";
import {
  acquireReconcileLock,
  fetchExpiringWatchChannels,
  fetchWatchChannelByOwner,
  releaseReconcileLock,
  updateWatchSyncToken,
  upsertWatchChannel,
  type WatchChannel,
} from "@/lib/data/calendar-watch";
import { fetchApplicationEmailContext } from "@/lib/data/candidates";
import { getRecruiterGmailClient } from "@/lib/actions/gmail-sender";
import { sendEmail } from "@/lib/services/email";
import { buildInterviewRescheduleNeededEmail } from "@/lib/services/email-templates/interview-reschedule-needed";
import { signResponseToken, SCHEDULE_TOKEN_TTL_MS } from "@/lib/auth/screening-token";

/**
 * Orchestration for the "recruiter moved the interview on their own calendar →
 * candidate re-picks" flow. Two entry points share it — the Google webhook
 * (reconcile) and the renewal cron (ensure) — so it lives here rather than in
 * either route handler, and runs on an injected admin `db`.
 */

/** Path Google POSTs calendar change notifications to (appended to the origin). */
export const GOOGLE_CALENDAR_WEBHOOK_PATH = "/api/webhooks/google-calendar";

/** Renew a channel once it's within this window of expiring. */
const RENEW_WITHIN_MS = 48 * 60 * 60 * 1000; // 48h
/** How far back a full resync reaches when the sync token is lost. */
const FULL_SYNC_LOOKBACK_MS = 48 * 60 * 60 * 1000; // 48h
/** A reconcile older than this is treated as crashed; its lock is reclaimable. */
const RECONCILE_LOCK_STALE_MS = 2 * 60 * 1000; // 2 min

/**
 * Ensure the recruiter has a live Google `events.watch` channel pointed at our
 * webhook, creating one on their first booking and renewing one that's near
 * expiry. Best-effort and idempotent: a healthy channel is a no-op, and a
 * missing Google connection / calendar scope just skips (the booking itself is
 * already durable). Returns whether a channel is active afterward.
 */
export async function ensureWatchChannel(params: {
  ownerUserId: string;
  /** Absolute HTTPS URL Google will POST change notifications to. */
  webhookUrl: string;
  now?: Date;
  db?: SupabaseDb;
}): Promise<boolean> {
  const { ownerUserId, webhookUrl, now = new Date() } = params;
  const db = params.db ?? createAdminClient();

  const existing = await fetchWatchChannelByOwner(ownerUserId, db);
  if (existing && !isNearExpiry(existing, now)) {
    return true; // healthy channel, nothing to do
  }

  const connection = await fetchGmailConnection(ownerUserId, db);
  if (!connection || !hasCalendarScopes(connection.scope)) {
    console.warn(
      `ensureWatchChannel: no calendar-enabled connection for owner ${ownerUserId} — watch skipped`,
    );
    return false;
  }

  const channelId = randomUUID();
  const channelToken = randomUUID();

  let opened;
  try {
    opened = await watchCalendarEvents({
      refreshToken: connection.refresh_token,
      address: webhookUrl,
      channelId,
      channelToken,
    });
  } catch (err) {
    console.error(
      `ensureWatchChannel: watch request failed for owner ${ownerUserId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }

  await upsertWatchChannel(
    {
      ownerUserId,
      channelId,
      resourceId: opened.resourceId ?? "",
      channelToken,
      // Keep the incremental cursor across a renewal; a brand-new channel starts
      // null so the first reconcile does a bounded full sync.
      syncToken: existing?.sync_token ?? null,
      expirationIso: opened.expirationIso,
    },
    db,
  );

  // Stop the superseded channel so Google isn't POSTing for a row we replaced.
  if (existing) {
    try {
      await stopCalendarWatch({
        refreshToken: connection.refresh_token,
        channelId: existing.channel_id,
        resourceId: existing.resource_id,
      });
    } catch (err) {
      console.warn(
        `ensureWatchChannel: failed to stop old channel for owner ${ownerUserId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return true;
}

function isNearExpiry(channel: WatchChannel, now: Date): boolean {
  if (!channel.expiration) return true; // unknown expiry → treat as due for renewal
  return new Date(channel.expiration).getTime() - now.getTime() <= RENEW_WITHIN_MS;
}

export interface RenewalResult {
  /** Channels found within the renewal window. */
  scanned: number;
  /** Channels successfully renewed. */
  renewed: number;
  /** Channels that failed to renew (logged, not thrown). */
  failed: number;
}

/**
 * Renew every watch channel nearing expiry — the scheduled-cron counterpart to
 * the lazy renewal on booking. Google's channels lapse (~7 days) and silently
 * stop delivering, so without this the sync goes dark. Each channel is handled
 * independently: one failure is logged and the sweep continues.
 */
export async function renewExpiringWatchChannels(params: {
  /** Absolute HTTPS webhook URL (origin + GOOGLE_CALENDAR_WEBHOOK_PATH). */
  webhookUrl: string;
  now?: Date;
  db?: SupabaseDb;
}): Promise<RenewalResult> {
  const { webhookUrl, now = new Date() } = params;
  const db = params.db ?? createAdminClient();

  const due = await fetchExpiringWatchChannels(new Date(now.getTime() + RENEW_WITHIN_MS), db);

  let renewed = 0;
  let failed = 0;
  for (const channel of due) {
    try {
      const active = await ensureWatchChannel({
        ownerUserId: channel.owner_user_id,
        webhookUrl,
        now,
        db,
      });
      if (active) renewed += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `renewExpiringWatchChannels: renewal failed for owner ${channel.owner_user_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { scanned: due.length, renewed, failed };
}

export interface ReconcileResult {
  /** True when this call ran the sync; false when another run held the lock. */
  ran: boolean;
  /** How many bookings were flipped to pending_reschedule (and emailed). */
  rescheduled: number;
}

/**
 * Reconcile the recruiter's calendar against our bookings after a change
 * notification. Serialized per recruiter by a best-effort mutex (to avoid
 * redundant Google calls on overlapping deliveries); correctness rests on the
 * conditional `booked → pending_reschedule` transition, which lets duplicate
 * deliveries cause at most one flip and one email regardless of the mutex.
 *
 * When a booked event's start no longer matches what we stored, the booking is
 * marked pending and the candidate is emailed their existing link to re-pick.
 * We never adopt the recruiter's new time directly — the candidate chooses.
 */
export async function reconcileCalendarChanges(params: {
  ownerUserId: string;
  /** Origin for building the candidate's absolute /schedule link. */
  scheduleOrigin: string;
  now?: Date;
  db?: SupabaseDb;
}): Promise<ReconcileResult> {
  const { ownerUserId, scheduleOrigin, now = new Date() } = params;
  const db = params.db ?? createAdminClient();

  const staleBefore = new Date(now.getTime() - RECONCILE_LOCK_STALE_MS);
  const gotLock = await acquireReconcileLock(ownerUserId, now, staleBefore, db);
  if (!gotLock) {
    // Another reconcile is in flight; its incremental sync covers this change.
    return { ran: false, rescheduled: 0 };
  }

  try {
    const channel = await fetchWatchChannelByOwner(ownerUserId, db);
    if (!channel) return { ran: true, rescheduled: 0 };

    const connection = await fetchGmailConnection(ownerUserId, db);
    if (!connection || !hasCalendarScopes(connection.scope)) {
      return { ran: true, rescheduled: 0 };
    }
    const refreshToken = connection.refresh_token;

    // Incremental sync from the stored cursor; on a stale token, drop it and
    // fall back to a bounded full sync.
    let changes;
    try {
      changes = await listChangedCalendarEvents({ refreshToken, syncToken: channel.sync_token });
    } catch (err) {
      if (!(err instanceof SyncTokenExpiredError)) throw err;
      await updateWatchSyncToken(ownerUserId, null, db);
      changes = await listChangedCalendarEvents({
        refreshToken,
        timeMinIso: new Date(now.getTime() - FULL_SYNC_LOOKBACK_MS).toISOString(),
      });
    }

    await updateWatchSyncToken(ownerUserId, changes.nextSyncToken, db);

    let rescheduled = 0;
    for (const event of changes.events) {
      if (!event.eventId || !event.startIso || event.status === "cancelled") continue;

      const booking = await fetchBookingByGoogleEventId(event.eventId, db);
      if (!booking || booking.status !== "booked") continue;
      if (event.startIso === booking.scheduled_at) continue; // no time change

      // Conditional flip: only the call that actually transitions the row fires
      // the email, so duplicate deliveries can't re-notify the candidate.
      const flipped = await markBookingPendingReschedule(booking.application_id, db);
      if (!flipped) continue;

      await notifyCandidateReschedule(booking.application_id, ownerUserId, scheduleOrigin, db);
      rescheduled += 1;
    }

    return { ran: true, rescheduled };
  } finally {
    await releaseReconcileLock(ownerUserId, db).catch((err) =>
      console.error(
        `reconcileCalendarChanges: failed to release lock for owner ${ownerUserId}:`,
        err instanceof Error ? err.message : err,
      ),
    );
  }
}

/**
 * Best-effort "please re-pick a time" email to the candidate, from the
 * recruiter's connected inbox. Never throws — a booking already flipped to
 * pending must not be undone by an email hiccup (the candidate can still reopen
 * their link, and reminders are a separate follow-up).
 */
async function notifyCandidateReschedule(
  applicationId: string,
  ownerUserId: string,
  scheduleOrigin: string,
  db: SupabaseDb,
): Promise<void> {
  try {
    const ctx = await fetchApplicationEmailContext(applicationId, db);
    if (!ctx) return;

    const token = signResponseToken(applicationId, SCHEDULE_TOKEN_TTL_MS);
    const scheduleUrl = `${scheduleOrigin}/schedule/${encodeURIComponent(token)}`;
    const email = buildInterviewRescheduleNeededEmail({
      candidateName: ctx.candidateName,
      campaignTitle: ctx.campaignTitle,
      scheduleUrl,
    });

    const gmail = await getRecruiterGmailClient(ownerUserId, db);
    await sendEmail(gmail, {
      to: ctx.candidateEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    console.error(
      `notifyCandidateReschedule: failed for application ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
