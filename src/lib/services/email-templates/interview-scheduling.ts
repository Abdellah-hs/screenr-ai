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
 * Candidate email on advancing to `interview_scheduling`: invites them to book
 * their AI interview via a self-scheduling link (PRD 3.5.6). Replaces the old
 * "we'll follow up" advance email, which carried no link.
 */
export function buildInterviewSchedulingEmail(
  params: InterviewSchedulingEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, scheduleUrl, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Schedule your ${campaignTitle} interview`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Great news — your screening for the ${campaignTitle} role stood out, and we'd like to move you forward to an interview.`,
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
                  Great news — your screening for the <strong>${escapeHtml(campaignTitle)}</strong> role stood out, and we'd like to move you forward to an interview.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  Pick a time that works for you:
                </p>
                ${renderButton(scheduleUrl, "Schedule your interview")}
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
