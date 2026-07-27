import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveInterviewTranscriptDraft } from "@/lib/data/interview-sessions";
import { uuidSchema, voiceTranscriptTurnSchema } from "@/lib/validations";

// Service-role write driven by a machine caller — always run on the server,
// never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Agent-report endpoint: the interview agent worker (agents/interview/) posts
 * the transcript it captured server-side while the candidate's video interview
 * is running. Turns land as a DRAFT on the interview_sessions row — the
 * candidate's explicit submit is what finalizes and advances the application,
 * and `saveInterviewTranscriptDraft` only writes while the session is still
 * open (invited / in_progress).
 *
 * Auth mirrors the screening route: `Authorization: Bearer ${AGENT_API_SECRET}`,
 * failing closed when the secret is unset. The worker holds the same secret in
 * its own environment.
 *
 * An agent-only transcript (no candidate turn yet) is accepted on purpose: the
 * worker reports incrementally during the call, and the "did the candidate
 * actually speak" gate lives in the candidate's submit action.
 */
const bodySchema = z.object({
  application_id: uuidSchema,
  transcript: z.array(voiceTranscriptTurnSchema).min(1).max(2000),
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

  await saveInterviewTranscriptDraft(
    parsed.data.application_id,
    parsed.data.transcript,
    createAdminClient(),
  );

  return NextResponse.json({ ok: true });
}
