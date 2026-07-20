import {
  escapeHtml,
  firstNameOf,
  renderButton,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface InterviewSchedulingEmailParams {
  candidateName: string;
  campaignTitle: string;
  /** Token-gated /schedule page where the candidate self-selects a slot. */
  scheduleUrl: string;
  companyName?: string;
}

/**
 * Candidate email on advancing to `final_interview_scheduling`: invites them
 * to book their final interview with the team via a self-scheduling link.
 * (Originally sent for the AI interview's `interview_scheduling` state; the
 * slot-booking machinery was repointed to the final human interview when the
 * AI interview became on-demand.)
 */
export function buildInterviewSchedulingEmail(
  params: InterviewSchedulingEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, scheduleUrl, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Schedule your final ${campaignTitle} interview`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Great news — you've reached the final stage for the ${campaignTitle} role, and we'd like to set up a final interview with the team.`,
    ``,
    `Pick a time that works for you here:`,
    scheduleUrl,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Great news — you&#39;ve reached the final stage for the <strong>${escapeHtml(campaignTitle)}</strong> role, and we&#39;d like to set up a final interview with the team.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  Pick a time that works for you:
                </p>
                ${renderButton(scheduleUrl, "Schedule your final interview")}
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
