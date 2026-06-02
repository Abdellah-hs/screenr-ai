"use server";

import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRealtimeSession, type RealtimeSession } from "@/lib/services/realtime";

/**
 * SPIKE (#81): mint an ephemeral OpenAI Realtime key for a bare browser voice
 * connection.
 *
 * Gated behind recruiter auth + a rate limit so it cannot be abused to burn
 * OpenAI quota. The real candidate flow (#83) replaces the `requireUserId`
 * guard with verified-screening-token gating on `/respond/[token]`, since
 * candidates have no session.
 */
export async function startVoiceSpikeSession(): Promise<RealtimeSession> {
  const userId = await requireUserId();

  checkRateLimit(userId, {
    name: "realtime-session",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  return createRealtimeSession();
}
