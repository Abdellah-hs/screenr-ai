import { NextResponse } from "next/server";
import { sweepInterviewReminders } from "@/lib/scheduling/reminder-sweep";

// Service-role writes + a live timestamp: must run per-request on the server.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled sweep that sends the 24h / 1h reminders ahead of a booked final
 * human interview.
 *
 * Protected by a shared secret: the caller must present
 * `Authorization: Bearer ${CRON_SECRET}`, and the route fails closed if that
 * secret is unset — see CLAUDE.md → Scheduled Jobs (Cron).
 *
 * **Cadence matters here in a way it does not for the expiry sweeps.** Those
 * close out deadlines that are already days old, so once a day is plenty. A
 * reminder is only useful before the thing it is reminding you about, and the
 * final hour cannot be caught by a job that looks once a day. `vercel.json`
 * therefore schedules this hourly — which needs a plan that allows more than
 * one run per day per path (Vercel Hobby does not; the other three sweeps in
 * `vercel.json` are daily for exactly that reason).
 *
 * On a daily cadence nothing breaks and nothing double-sends: the 24h reminder
 * still lands somewhere inside the final day, and the 1h one is quietly retired
 * unsent rather than arriving late. That degradation is deliberate, not an
 * oversight — see `dueInterviewReminders`.
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

  const result = await sweepInterviewReminders();
  return NextResponse.json({ ok: true, ...result });
}
