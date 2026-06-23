import { NextResponse } from "next/server";
import { sweepResumeSync } from "@/lib/resume-sync/sync-sweep";

// Service-role reads/writes + live Gmail/OpenAI calls: must run per-request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled resume sync: pulls new CVs into every Active campaign automatically,
 * so recruiters don't have to press "Sync from Gmail". The session-bound button
 * still works for an on-demand pull; this is the background counterpart.
 *
 * Protected by a shared secret: the caller must present
 * `Authorization: Bearer ${CRON_SECRET}`. Wire a scheduler (Supabase pg_cron +
 * pg_net, Vercel Cron, or any external cron) to hit this URL — see
 * CLAUDE.md → Scheduled Jobs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never leave the endpoint open.
    console.error("CRON_SECRET is not configured; refusing to run resume sync.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepResumeSync();
  return NextResponse.json({ ok: true, ...result });
}
