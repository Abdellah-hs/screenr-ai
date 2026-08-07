import type { ApplicationState } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchApplicationEmailContext } from "@/lib/data/candidates";
import { sendEmail } from "@/lib/services/email";
import { getRecruiterGmailClient } from "./gmail-sender";
import { getRequestOrigin } from "@/lib/http/origin";
import {
  signResponseToken,
  SCHEDULE_TOKEN_TTL_MS,
  INTERVIEW_TOKEN_TTL_MS,
} from "@/lib/auth/screening-token";
import { ensureInterviewSession } from "@/lib/data/interview-sessions";
import { buildInterviewAdvanceEmail } from "@/lib/services/email-templates/interview-advance";
import { buildInterviewInviteEmail } from "@/lib/services/email-templates/interview-invite";
import { buildInterviewSchedulingEmail } from "@/lib/services/email-templates/interview-scheduling";
import { buildRejectScreeningEmail } from "@/lib/services/email-templates/reject-screening";
import { buildHiredEmail } from "@/lib/services/email-templates/hired";
import type { BuiltEmail } from "@/lib/services/email-templates/shared";

interface TransitionEmailContext {
  candidateName: string;
  campaignTitle: string;
  /** Token-gated /schedule link — present only for final_interview_scheduling. */
  scheduleUrl?: string;
  /** Token-gated /interview link + deadline — present only for interview_invited. */
  interviewUrl?: string;
  interviewExpiresAt?: string;
}

/**
 * Maps a destination state to the candidate email it should trigger, or null
 * when that state has no candidate-facing notification.
 *
 * States with a live transition emitter today:
 *   - interview_invited          → "you're moving to the interview round" (no
 *     link — replaced by the real AI-interview invite when that flow ships)
 *   - final_interview_scheduling → self-scheduling invite for the final human
 *     interview (carries the booking link)
 *   - hired                      → congratulations email (the formal offer
 *     follows from a human — this states no terms)
 *   - rejected                   → rejection email
 *
 * The interview-confirmation and reminder templates also exist; confirmation
 * is sent from the booking action itself, and reminders need a scheduler
 * (tracked as a separate follow-up).
 */
function buildTransitionEmail(
  toState: ApplicationState,
  ctx: TransitionEmailContext,
): BuiltEmail | null {
  switch (toState) {
    case "interview_invited":
      // With the AI interview live, carry the real invite link. Fall back to
      // the link-free advance notice only if the URL couldn't be built (e.g.
      // missing origin) so the candidate is never left with a broken link.
      if (!ctx.interviewUrl) {
        return buildInterviewAdvanceEmail({
          candidateName: ctx.candidateName,
          campaignTitle: ctx.campaignTitle,
        });
      }
      return buildInterviewInviteEmail({
        candidateName: ctx.candidateName,
        campaignTitle: ctx.campaignTitle,
        interviewUrl: ctx.interviewUrl,
        expiresAt: ctx.interviewExpiresAt,
      });
    case "final_interview_scheduling":
      // The caller always supplies scheduleUrl for this state; guard anyway so
      // a missing origin/token degrades to "no email" rather than a broken link.
      if (!ctx.scheduleUrl) return null;
      return buildInterviewSchedulingEmail({
        candidateName: ctx.candidateName,
        campaignTitle: ctx.campaignTitle,
        scheduleUrl: ctx.scheduleUrl,
      });
    case "hired":
      return buildHiredEmail(ctx);
    case "rejected":
      return buildRejectScreeningEmail(ctx);
    default:
      return null;
  }
}

/**
 * Best-effort candidate notification for a state transition. Call it from an
 * action AFTER a successful transitionApplication(), passing the acting
 * recruiter's `userId` — the email is sent from their connected inbox.
 *
 * It never throws: the transition is already durable, so a failed email must
 * not roll it back or surface as an error to the recruiter. A missing Gmail
 * connection is one such failure — logged, not propagated.
 */
export async function sendTransitionNotification(
  applicationId: string,
  toState: ApplicationState,
  userId: string,
): Promise<void> {
  try {
    // Admin client on purpose: transitions fire from recruiter sessions AND
    // from session-less candidate flows (voice screening auto-score). The
    // cookie client would hit owner-only RLS in the latter and silently skip
    // the email. The caller has already authorized the transition itself.
    const db = createAdminClient();

    const ctx = await fetchApplicationEmailContext(applicationId, db);
    if (!ctx) return;

    // The self-scheduling invite needs an absolute, token-gated booking link.
    let scheduleUrl: string | undefined;
    if (toState === "final_interview_scheduling") {
      const origin = await getRequestOrigin();
      const token = signResponseToken(applicationId, SCHEDULE_TOKEN_TTL_MS);
      scheduleUrl = `${origin}/schedule/${encodeURIComponent(token)}`;
    }

    // The AI interview invite needs a token-gated /interview link + a deadline,
    // and the session row must exist so the agent's transcript reports have a
    // row to land on. Best-effort: a session-ensure failure must not block the
    // email (the candidate can still be re-invited).
    let interviewUrl: string | undefined;
    let interviewExpiresAt: string | undefined;
    if (toState === "interview_invited") {
      const origin = await getRequestOrigin();
      const token = signResponseToken(applicationId, INTERVIEW_TOKEN_TTL_MS);
      interviewUrl = `${origin}/interview/${encodeURIComponent(token)}`;
      const expiresAt = new Date(Date.now() + INTERVIEW_TOKEN_TTL_MS);
      interviewExpiresAt = expiresAt.toISOString();
      try {
        await ensureInterviewSession(applicationId, expiresAt, db);
      } catch (err) {
        console.error(
          `Failed to ensure interview session for ${applicationId} (non-blocking):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const email = buildTransitionEmail(toState, {
      candidateName: ctx.candidateName,
      campaignTitle: ctx.campaignTitle,
      scheduleUrl,
      interviewUrl,
      interviewExpiresAt,
    });
    if (!email) return; // no notification configured for this state

    const gmail = await getRecruiterGmailClient(userId, db);
    await sendEmail(gmail, {
      to: ctx.candidateEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    console.log(`Transition email sent: ${applicationId} → ${toState}`);
  } catch (err) {
    console.error(
      `Transition notification for ${applicationId} → ${toState} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
