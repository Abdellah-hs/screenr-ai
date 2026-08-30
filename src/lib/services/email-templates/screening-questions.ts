import { screeningCallEstimateMinutes } from "@/lib/constants";

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
 *
 * It describes a **spoken** screening, because that is what the link opens.
 * This copy was written for the typed form that #161 deleted: it promised
 * "15–25 minutes to complete them" and a button reading "Answer the questions",
 * so a candidate budgeted twenty minutes of typing and landed on a live call
 * needing a microphone and a quiet room. The length comes from
 * `screeningCallEstimateMinutes`.
 *
 * "About" is meant literally: since 2026-08-24 there is no hard cut to promise
 * against. The call is paced per answer and ends when its topics are covered,
 * so this number sets an expectation and enforces nothing. This is now the
 * ONLY place it is quoted: the pre-call screen dropped it, on the grounds that
 * a screen the candidate reads seconds before starting should not open with a
 * number nothing enforces. It survives here because an INVITATION is read days
 * ahead and has to help somebody decide when to sit down for this.
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
  const minutes = screeningCallEstimateMinutes(questionCount);

  const subject = `Next step for ${campaignTitle}: a short spoken interview`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thanks for applying to the ${campaignTitle} role. Your resume looks like a promising fit, and ${companyName} would like to learn a bit more before inviting you to a full interview.`,
    ``,
    `The next step is a short spoken interview with our AI interviewer — about ${minutes} minutes, covering ${questionCount} topics. There are no right or wrong answers; we're just looking for concrete examples and your honest perspective.`,
    ``,
    `You'll need a quiet spot and a working microphone. Nothing is recorded — only a written transcript is kept — and you can stop and start again at any point while the call is still yours.`,
    ``,
    `Start here:`,
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
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  The next step is a <strong>short spoken interview</strong> with our AI interviewer — about <strong>${minutes} minutes</strong>, covering ${questionCount} topics. There are no right or wrong answers; we're just looking for concrete examples and your honest perspective.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  You'll need a quiet spot and a working microphone. Nothing is recorded — only a written transcript is kept — and you can stop and start again at any point while the call is still yours.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px;">
                  <tr>
                    <td align="center" bgcolor="#111827" style="border-radius: 8px;">
                      <a href="${safeUrl}" style="display:inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                        Start the interview
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
