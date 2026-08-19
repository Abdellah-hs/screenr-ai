"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { peekResponseToken } from "@/lib/auth/screening-token";
import { fetchInterviewContextByApplicationId } from "@/lib/data/candidates";
import { buildPrepGuide, type PrepGuide } from "@/lib/interview/prep-guide";

export interface InterviewPrepContext {
  campaignTitle: string;
  guide: PrepGuide;
  /** When the candidate's interview link lapses. */
  expiresAt: string;
}

export type InterviewPrepResult =
  | { state: "ready"; context: InterviewPrepContext }
  | { state: "expired" }
  | { state: "invalid"; message: string };

/**
 * Load the prep guide for a candidate's interview link (I23).
 *
 * Token-gated and account-free, like every candidate-facing page. Reads through
 * the admin client because `applications` and `campaigns` are owner-only RLS —
 * the candidate has no session, so the verified token IS the authorization.
 *
 * `peekResponseToken` rather than `verifyResponseToken`, and the distinction is
 * deliberate: a lapsed token still authenticates (the signature check is
 * identical), which lets this say "your link has expired" instead of the
 * generic failure a throw would produce. Per that helper's contract an expired
 * token is never treated as access — the expired branch returns **no campaign
 * data at all**, only the fact that it lapsed.
 *
 * Read-only. Unlike the interview page, opening a dead prep link transitions
 * nothing: a candidate reading the guide has not failed to attend, and closing
 * out their application because they clicked the wrong link in an old email
 * would be a side effect nobody asked for.
 */
export async function loadInterviewPrep(token: string): Promise<InterviewPrepResult> {
  let peeked;
  try {
    peeked = peekResponseToken(token);
  } catch (err) {
    return {
      state: "invalid",
      message: err instanceof Error ? err.message : "This link could not be opened.",
    };
  }

  if (peeked.expired) return { state: "expired" };

  const db = createAdminClient();
  const ctx = await fetchInterviewContextByApplicationId(peeked.application_id, db);
  if (!ctx) {
    return { state: "invalid", message: "This link is no longer available." };
  }

  return {
    state: "ready",
    context: {
      campaignTitle: ctx.campaign_title,
      guide: buildPrepGuide({
        roleTitle: ctx.campaign_title,
        persona: ctx.interview_persona,
      }),
      expiresAt: peeked.expires_at.toISOString(),
    },
  };
}
