import {
  escapeHtml,
  firstNameOf,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface RejectScreeningEmailParams {
  candidateName: string;
  campaignTitle: string;
  companyName?: string;
}

/**
 * Candidate rejection email. Sent on the transition into `rejected`.
 *
 * Per the PRD, rejection flows must NOT expose internal ranking, scores, or
 * comparative rationale — so this template intentionally takes no score or
 * AI-rationale parameter. It is a plain, respectful close-out.
 */
export function buildRejectScreeningEmail(
  params: RejectScreeningEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Update on your ${campaignTitle} application`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thank you for your interest in the ${campaignTitle} role and for the time you put into your application.`,
    ``,
    `After careful consideration, we've decided not to move forward with your application at this stage. This was a competitive process, and the decision is not a reflection of your abilities.`,
    ``,
    `We'd genuinely encourage you to apply for future roles that match your experience. We wish you the very best in your search.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Thank you for your interest in the <strong>${escapeHtml(campaignTitle)}</strong> role and for the time you put into your application.
                </p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  After careful consideration, we've decided not to move forward with your application at this stage. This was a competitive process, and the decision is not a reflection of your abilities.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  We'd genuinely encourage you to apply for future roles that match your experience. We wish you the very best in your search.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
