import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWatchChannelByChannelId } from "@/lib/data/calendar-watch";
import { reconcileCalendarChanges } from "@/lib/scheduling/calendar-sync";
import { getRequestOrigin } from "@/lib/http/origin";

// Google POSTs change pings here; service-role reads/writes, never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Google Calendar push-notification receiver. Google POSTs a header-only "ping"
 * (no body) whenever a watched calendar changes. We authenticate the ping
 * against the stored channel — matching id + resourceId + a constant-time token
 * compare — then reconcile that recruiter's calendar against our bookings.
 *
 * Auth is per-channel (the token we generated at watch time and Google echoes
 * back), so there's no global secret/env var. Unknown or mismatched channels
 * are ignored (200/401) rather than trusted.
 *
 * A "sync" ping (Google's initial channel handshake) is acknowledged only. An
 * "exists" ping triggers reconciliation. We always ack fast; reconciliation is
 * one incremental sync plus a few row lookups, cheap enough to run inline.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const channelToken = request.headers.get("x-goog-channel-token");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const db = createAdminClient();
  const channel = await fetchWatchChannelByChannelId(channelId, db);

  // Unknown channel — likely superseded by a renewal. Ack so Google stops
  // retrying; there's nothing to do.
  if (!channel) {
    return NextResponse.json({ ok: true, ignored: "unknown channel" });
  }

  // Both the resource id and the per-channel token must match. The token
  // compare is constant-time to avoid leaking it via timing.
  const resourceOk = resourceId != null && resourceId === channel.resource_id;
  const tokenOk = channelToken != null && safeEqual(channelToken, channel.channel_token);
  if (!resourceOk || !tokenOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The initial handshake carries no change to reconcile.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, sync: true });
  }

  const origin = await getRequestOrigin();
  const result = await reconcileCalendarChanges({
    ownerUserId: channel.owner_user_id,
    scheduleOrigin: origin,
    db,
  });

  return NextResponse.json({ ok: true, ...result });
}

/** Constant-time string compare that tolerates length mismatch without throwing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
