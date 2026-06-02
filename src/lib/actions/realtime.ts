"use server";

import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { uuidSchema } from "@/lib/validations";
import { fetchCampaignById } from "@/lib/data/campaigns";
import { fetchScreeningQuestionsByCampaignId } from "@/lib/data/screening-questions";
import {
  createRealtimeSession,
  buildScreeningInstructions,
  type RealtimeSession,
} from "@/lib/services/realtime";

const REALTIME_RATE_LIMIT = {
  name: "realtime-session",
  maxRequests: 10,
  windowMs: 5 * 60 * 1000,
} as const;

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
  checkRateLimit(userId, REALTIME_RATE_LIMIT);
  return createRealtimeSession();
}

/**
 * Mint a Realtime session driven by a campaign's screening questions (#82),
 * with unscripted-follow-up instructions (the anti-reading-off design).
 *
 * Recruiter-gated **preview** of the screening call. The candidate-facing flow
 * (#83) reuses `buildScreeningInstructions` but gates on a verified screening
 * token on `/respond/[token]` and persists the transcript.
 */
export async function startScreeningPreviewSession(
  campaignId: string,
): Promise<RealtimeSession> {
  const userId = await requireUserId();
  uuidSchema.parse(campaignId);
  checkRateLimit(userId, REALTIME_RATE_LIMIT);

  // fetchCampaignById filters by user_id, so a null result is also the
  // ownership check.
  const campaign = await fetchCampaignById(campaignId, userId);
  if (!campaign) throw new Error("Campaign not found");

  const questions = await fetchScreeningQuestionsByCampaignId(campaignId);

  const instructions = buildScreeningInstructions({
    jobTitle: campaign.title,
    questions: questions.map((q) => ({ prompt: q.prompt, is_required: q.is_required })),
  });

  return createRealtimeSession({ instructions });
}
