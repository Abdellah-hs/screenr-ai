import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveVoiceTranscriptDraft } from "@/lib/data/screening-questions";
import { uuidSchema, voiceTranscriptTurnSchema } from "@/lib/validations";

// Service-role write driven by a machine caller — always run on the server,
// never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Agent-report endpoint: the screening agent worker (agents/screening/) posts
 * the transcript it captured server-side while the candidate's voice call is
 * running. Turns land as a DRAFT on the response row — the candidate's
 * explicit submit on the review step is what finalizes and advances the
 * application, and `saveVoiceTranscriptDraft` only writes while the response
 * is still `sent`.
 *
 * Auth mirrors the cron route: `Authorization: Bearer ${AGENT_API_SECRET}`,
 * failing closed when the secret is unset. The worker holds the same secret
 * in its own environment.
 *
 * An agent-only transcript (no candidate turn yet) is accepted on purpose:
 * the worker reports incrementally during the call, and the "did the candidate
 * actually speak" gate lives in the candidate's submit action.
 */
const bodySchema = z.object({
  application_id: uuidSchema,
  transcript: z.array(voiceTranscriptTurnSchema).min(1).max(500),
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

  await saveVoiceTranscriptDraft(
    parsed.data.application_id,
    parsed.data.transcript,
    createAdminClient(),
  );

  return NextResponse.json({ ok: true });
}
