export interface ScreeningEmailParams {
  candidateName: string;
  campaignTitle: string;
  companyName?: string;
  respondUrl: string;
  expiresAt: Date;
  questionCount: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDeadline(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Build the screening-questions candidate email (subject + html + text).
 * Deliberately plain and friendly — no heavy branding, no external images,
 * so it renders well in every client and doesn't get flagged as marketing.
 */
export function buildScreeningQuestionsEmail(params: ScreeningEmailParams) {
  const {
    candidateName,
    campaignTitle,
    companyName = "the hiring team",
    respondUrl,
    expiresAt,
    questionCount,
  } = params;

  const deadline = formatDeadline(expiresAt);
  const firstName = candidateName.split(" ")[0] || candidateName;

  const subject = `Next step for ${campaignTitle}: a few screening questions`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thanks for applying to the ${campaignTitle} role. Your resume looks like a promising fit, and ${companyName} would like to learn a bit more before inviting you to a full interview.`,
    ``,
    `We've prepared ${questionCount} short questions for you. There are no right or wrong answers — we're just looking for concrete examples and your honest perspective. Most candidates take 15–25 minutes to complete them.`,
    ``,
    `Answer here:`,
    `${respondUrl}`,
    ``,
    `Please respond by ${deadline}. If the link expires, just reply to this email and we'll send a fresh one.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const safeName = escapeHtml(firstName);
  const safeTitle = escapeHtml(campaignTitle);
  const safeCompany = escapeHtml(companyName);
  const safeUrl = escapeHtml(respondUrl);
  const safeDeadline = escapeHtml(deadline);

  const html = `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f9fafb; margin:0; padding:24px 0; color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border-radius:12px; border:1px solid #e5e7eb; max-width: 560px;">
            <tr>
              <td style="padding: 32px 36px;">
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${safeName},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Thanks for applying to the <strong>${safeTitle}</strong> role. Your resume looks like a promising fit, and ${safeCompany} would like to learn a bit more before inviting you to a full interview.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  We've prepared <strong>${questionCount} short questions</strong> for you. There are no right or wrong answers — we're just looking for concrete examples and your honest perspective. Most candidates take 15–25 minutes to complete them.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px;">
                  <tr>
                    <td align="center" bgcolor="#111827" style="border-radius: 8px;">
                      <a href="${safeUrl}" style="display:inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                        Answer the questions
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#6b7280;">
                  Please respond by <strong>${safeDeadline}</strong>. If the link expires, just reply to this email and we'll send a fresh one.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${safeCompany}
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0; font-size:11px; color:#9ca3af;">
            This email was sent via Screenr AI. If you did not apply for this role, please ignore it.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
