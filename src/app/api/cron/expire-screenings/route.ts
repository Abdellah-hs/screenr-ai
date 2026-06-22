import { NextResponse } from "next/server";
import { sweepExpiredScreenings } from "@/lib/screening/expiry-sweep";

// Service-role writes + a live timestamp: must run per-request on the server.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled sweep that moves overdue screening links to `screening_expired`
 * (the proactive counterpart to the lazy expiry on the candidate's own page).
 *
 * Protected by a shared secret: the caller must present
 * `Authorization: Bearer ${CRON_SECRET}`. Wire a scheduler (Vercel Cron,
 * Supabase pg_cron + pg_net, or any external cron) to hit this URL — see
 * CLAUDE.md → Environment Variables.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never leave the endpoint open.
    console.error("CRON_SECRET is not configured; refusing to run the sweep.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepExpiredScreenings();
  return NextResponse.json({ ok: true, ...result });
}
