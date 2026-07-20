import {
  escapeHtml,
  firstNameOf,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface InterviewAdvanceEmailParams {
  candidateName: string;
  campaignTitle: string;
  companyName?: string;
}

/**
 * Candidate email on advancing to `interview_invited`: tells them they passed
 * screening and are moving to the interview round. Carries NO link on purpose —
 * the on-demand AI interview isn't live yet, so there is nothing to point at.
 * When the AI interview ships its invite flow (token link + deadline), that
 * invite email supersedes this one.
 */
export function buildInterviewAdvanceEmail(
  params: InterviewAdvanceEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `You're moving forward — ${campaignTitle} interview`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Great news — your screening for the ${campaignTitle} role stood out, and we'd like to move you forward to the interview round.`,
    ``,
    `We'll follow up shortly with your interview details.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Great news — your screening for the <strong>${escapeHtml(campaignTitle)}</strong> role stood out, and we'd like to move you forward to the interview round.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  We'll follow up shortly with your interview details.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
