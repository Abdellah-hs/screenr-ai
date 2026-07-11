import {
  escapeHtml,
  firstNameOf,
  renderButton,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface ApplicationProblemEmailParams {
  candidateName: string;
  campaignTitle: string;
  /** Candidate-facing, actionable explanation of what went wrong. */
  reasonMessage: string;
  /** Public apply page where the candidate can resubmit. */
  applyUrl: string;
  companyName?: string;
}

/**
 * Candidate email sent when background CV processing could not accept their
 * submission (file wasn't a CV, unreadable, etc.). Exists because the apply
 * form responds instantly and processes the CV after the response — this
 * email replaces the inline error the candidate used to wait for.
 */
export function buildApplicationProblemEmail(
  params: ApplicationProblemEmailParams,
): BuiltEmail {
  const {
    candidateName,
    campaignTitle,
    reasonMessage,
    applyUrl,
    companyName = "the hiring team",
  } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Action needed — your ${campaignTitle} application`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thanks for applying for the ${campaignTitle} role. Unfortunately we couldn't process your application:`,
    ``,
    `  ${reasonMessage}`,
    ``,
    `Please apply again here:`,
    applyUrl,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Thanks for applying for the <strong>${escapeHtml(campaignTitle)}</strong> role.
                  Unfortunately we couldn&#39;t process your application:
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:12px 16px;">
                  ${escapeHtml(reasonMessage)}
                </p>
                ${renderButton(applyUrl, "Apply again")}
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
