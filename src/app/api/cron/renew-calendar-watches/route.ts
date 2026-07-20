import { NextResponse } from "next/server";
import {
  renewExpiringWatchChannels,
  GOOGLE_CALENDAR_WEBHOOK_PATH,
} from "@/lib/scheduling/calendar-sync";
import { getRequestOrigin } from "@/lib/http/origin";

// Service-role writes + live Google calls: run per-request, never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled renewal of Google Calendar watch channels. Google's channels lapse
 * (~7 days) and then silently stop delivering change notifications, so this
 * re-watches every channel nearing expiry — the proactive counterpart to the
 * lazy renewal that runs on each booking.
 *
 * Protected by the same shared secret as the other cron endpoints
 * (`Authorization: Bearer ${CRON_SECRET}`), failing closed when unset. Wire any
 * scheduler to hit it — see CLAUDE.md → Scheduled Jobs. Inert until one is.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not configured; refusing to renew watches.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = await getRequestOrigin();
  const result = await renewExpiringWatchChannels({
    webhookUrl: `${origin}${GOOGLE_CALENDAR_WEBHOOK_PATH}`,
  });

  return NextResponse.json({ ok: true, ...result });
}
