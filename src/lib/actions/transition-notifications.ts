import type { ApplicationState } from "@/lib/constants";
import { fetchApplicationEmailContext } from "@/lib/data/candidates";
import { sendEmail } from "@/lib/services/email";
import { getRecruiterGmailClient } from "./gmail-sender";
import { buildAdvanceScreeningEmail } from "@/lib/services/email-templates/advance-screening";
import { buildRejectScreeningEmail } from "@/lib/services/email-templates/reject-screening";
import type { BuiltEmail } from "@/lib/services/email-templates/shared";

/**
 * Maps a destination state to the candidate email it should trigger, or null
 * when that state has no candidate-facing notification.
 *
 * Only the two states with a live transition emitter are wired today:
 *   - interview_scheduling → "you passed screening" advance email
 *   - rejected             → rejection email
 *
 * The interview-confirmation (`interview_scheduled`) and reminder templates
 * also exist but stay unwired — confirmation needs interview self-scheduling
 * and reminders need a scheduler, both tracked as separate follow-ups.
 */
function buildTransitionEmail(
  toState: ApplicationState,
  ctx: { candidateName: string; campaignTitle: string },
): BuiltEmail | null {
  switch (toState) {
    case "interview_scheduling":
      return buildAdvanceScreeningEmail(ctx);
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
    const ctx = await fetchApplicationEmailContext(applicationId);
    if (!ctx) return;

    const email = buildTransitionEmail(toState, {
      candidateName: ctx.candidateName,
      campaignTitle: ctx.campaignTitle,
    });
    if (!email) return; // no notification configured for this state

    const gmail = await getRecruiterGmailClient(userId);
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
