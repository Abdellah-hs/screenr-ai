import {
  escapeHtml,
  firstNameOf,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface AdvanceScreeningEmailParams {
  candidateName: string;
  campaignTitle: string;
  companyName?: string;
}

/**
 * Candidate email for passing screening and advancing toward an interview.
 * Sent on the transition into `interview_scheduling`. Deliberately carries
 * no scheduling link yet — interview self-scheduling is a separate feature;
 * until it lands, this just tells the candidate the interview step is next.
 */
export function buildAdvanceScreeningEmail(
  params: AdvanceScreeningEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Good news about your ${campaignTitle} application`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Great news — your screening responses for the ${campaignTitle} role stood out, and we'd like to move you forward to an interview.`,
    ``,
    `We'll follow up shortly with the details for scheduling your interview. There's nothing you need to do right now.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Great news — your screening responses for the <strong>${escapeHtml(campaignTitle)}</strong> role stood out, and we'd like to move you forward to an interview.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  We'll follow up shortly with the details for scheduling your interview. There's nothing you need to do right now.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
