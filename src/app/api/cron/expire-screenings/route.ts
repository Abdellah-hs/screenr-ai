import { NextResponse } from "next/server";
import { sweepExpiredScreenings } from "@/lib/screening/expiry-sweep";
import { requireBearerSecret } from "@/lib/auth/guards";

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
  const denied = requireBearerSecret(request, "CRON_SECRET", "the sweep");
  if (denied) return denied;

  const result = await sweepExpiredScreenings();
  return NextResponse.json({ ok: true, ...result });
}
