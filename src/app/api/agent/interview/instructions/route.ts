import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeInterviewInstructions } from "@/lib/interview/instructions";
import { uuidSchema } from "@/lib/validations";
import { requireBearerSecret } from "@/lib/auth/guards";

// Service-role read driven by a machine caller — always run on the server,
// never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The interview agent worker (agents/interview/) fetches the interviewer
 * instructions for the room it was dispatched into. The screening twin of this
 * route carries the full rationale; the short version is that LiveKit room
 * metadata reaches every participant, and these instructions embed the
 * candidate's résumé and the campaign's interviewing stance.
 *
 * Auth mirrors the other agent routes: `Authorization: Bearer ${AGENT_API_SECRET}`,
 * failing closed when the secret is unset.
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, "AGENT_API_SECRET", "agent request");
  if (denied) return denied;

  const applicationId = new URL(request.url).searchParams.get("application_id");
  const parsed = uuidSchema.safeParse(applicationId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid application_id" }, { status: 400 });
  }

  const instructions = await composeInterviewInstructions(
    parsed.data,
    createAdminClient(),
  );
  if (!instructions) {
    return NextResponse.json({ error: "No interview to run" }, { status: 404 });
  }

  return NextResponse.json({ instructions });
}
