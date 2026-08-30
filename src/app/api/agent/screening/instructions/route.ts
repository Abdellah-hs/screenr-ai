import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeScreeningInstructions } from "@/lib/screening/instructions";
import { uuidSchema } from "@/lib/validations";
import { requireBearerSecret } from "@/lib/auth/guards";

// Service-role read driven by a machine caller — always run on the server,
// never cached. Caching would be actively wrong: a recruiter editing the
// questions must reach the next call, not the one after the TTL.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The screening agent worker (agents/screening/) fetches the interviewer
 * instructions for the room it was dispatched into.
 *
 * This is a READ where every other agent route is a report, and the direction
 * is the whole point. The instructions used to travel in LiveKit room metadata,
 * which LiveKit delivers to every participant — so the candidate's own browser
 * received the confidential topic guide before the interviewer had asked
 * anything (docs/voice-screening.md, mitigation #2). Metadata now carries the
 * application id alone; the guide crosses server-to-server behind the same
 * shared secret as the transcript report.
 *
 * Auth mirrors the other agent routes: `Authorization: Bearer ${AGENT_API_SECRET}`,
 * failing closed when the secret is unset. That secret already permits writing
 * a candidate's transcript, so it is not weakened by also reading the questions.
 *
 * 404 rather than an empty string when there is nothing to run: an interviewer
 * with no topics would hold a five-minute conversation that scores zero on
 * every rubric dimension, and a worker that fails loudly is recoverable where
 * one that improvises is not.
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, "AGENT_API_SECRET", "agent request");
  if (denied) return denied;

  const applicationId = new URL(request.url).searchParams.get("application_id");
  const parsed = uuidSchema.safeParse(applicationId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid application_id" }, { status: 400 });
  }

  // A worker that is being pushed its questions asks for this explicitly. Its
  // absence means a worker driving the call itself — an older one, or one with
  // topic control switched off — which must still get a complete,
  // self-sufficient prompt, or deploying the app first would hand it an
  // interviewer with no topics at all.
  //
  // The wire value is still `tool`, from when the questions were pulled through
  // a `next_topic` tool. Kept deliberately: a worker and an app on either side
  // of the push change still understand each other during a rollout.
  const withholdTopics =
    new URL(request.url).searchParams.get("topics") === "tool";

  const composed = await composeScreeningInstructions(
    parsed.data,
    createAdminClient(),
    withholdTopics,
  );
  if (!composed) {
    return NextResponse.json({ error: "No screening to run" }, { status: 404 });
  }

  return NextResponse.json({
    instructions: composed.instructions,
    topic_fallback: composed.topicFallback,
  });
}
