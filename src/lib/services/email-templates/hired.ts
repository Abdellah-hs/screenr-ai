import {
  escapeHtml,
  firstNameOf,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface HiredEmailParams {
  candidateName: string;
  campaignTitle: string;
  companyName?: string;
}

/**
 * Candidate congratulations email. Sent on the transition into `hired`.
 *
 * It deliberately states no offer terms — salary, start date, and contract
 * details live outside the ATS, so inventing them here would put the system's
 * words on a commitment it cannot back. The email congratulates and hands off
 * to a human, who sends the formal offer.
 */
export function buildHiredEmail(params: HiredEmailParams): BuiltEmail {
  const { candidateName, campaignTitle, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Congratulations — we'd like to offer you the ${campaignTitle} role`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Congratulations! After every stage of the process, we'd like to offer you the ${campaignTitle} role.`,
    ``,
    `Thank you for the care you put into each conversation — you made a strong impression on everyone you met.`,
    ``,
    `Someone from our team will be in touch shortly with your formal offer and the next steps. If any questions come up before then, just reply to this email.`,
    ``,
    `Welcome aboard,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  <strong>Congratulations!</strong> After every stage of the process, we'd like to offer you the <strong>${escapeHtml(campaignTitle)}</strong> role.
                </p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Thank you for the care you put into each conversation — you made a strong impression on everyone you met.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  Someone from our team will be in touch shortly with your formal offer and the next steps. If any questions come up before then, just reply to this email.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Welcome aboard,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
