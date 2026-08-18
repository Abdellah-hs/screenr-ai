import { NextResponse } from "next/server";
import { sweepAutoArchive } from "@/lib/archive/auto-archive-sweep";

// Service-role writes + a live timestamp: must run per-request on the server.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled sweep that moves non-responsive candidates to `archived` once they
 * pass their campaign's configured window (PRD 3.12.4).
 *
 * Runs AFTER the two expiry sweeps in the daily schedule — it can only archive
 * applications those sweeps have already moved into a failure state.
 *
 * Protected by a shared secret: the caller must present
 * `Authorization: Bearer ${CRON_SECRET}`. Fails closed when unset.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not configured; refusing to run the sweep.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepAutoArchive();
  return NextResponse.json({ ok: true, ...result });
}
