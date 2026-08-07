import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveVisionObservationsDraft } from "@/lib/data/interview-sessions";
import { uuidSchema, visionObservationsSchema } from "@/lib/validations";

// Service-role write driven by a machine caller — always run on the server,
// never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Agent-report endpoint for vision proctoring (Phase C2): the interview agent
 * worker (agents/interview/) samples frames from the candidate's published video
 * track, runs a vision model over them, and posts the observations it has
 * accumulated so far. They land as a DRAFT on the interview_sessions row and are
 * folded into the final proctoring report by `summarizeProctoring` when the
 * candidate submits.
 *
 * This is the one proctoring signal the candidate's machine does NOT supply —
 * which is the whole point of it. Auth mirrors the transcript route:
 * `Authorization: Bearer ${AGENT_API_SECRET}`, failing closed when the secret is
 * unset, and `saveVisionObservationsDraft` only writes while the session is open.
 *
 * What this route deliberately does not accept: any severity, any incident type,
 * any conclusion about the candidate. The worker reports counts and its own
 * confidence; the rule layer decides what — if anything — that means. A worker
 * (or anything holding its secret) therefore cannot manufacture an incident, only
 * the raw readings one is derived from.
 */
const bodySchema = z.object({
  application_id: uuidSchema,
  observations: visionObservationsSchema,
});

export async function POST(request: Request) {
  const secret = process.env.AGENT_API_SECRET;
  if (!secret) {
    console.error("AGENT_API_SECRET is not configured; refusing agent report.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  await saveVisionObservationsDraft(
    parsed.data.application_id,
    parsed.data.observations,
    createAdminClient(),
  );

  return NextResponse.json({ ok: true });
}
