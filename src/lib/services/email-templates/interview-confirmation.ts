import {
  escapeHtml,
  firstNameOf,
  formatDateTime,
  renderButton,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface InterviewConfirmationEmailParams {
  candidateName: string;
  campaignTitle: string;
  interviewAt: Date;
  /** Web prep-guide page (per the PRD this is a page, not a PDF). */
  prepGuideUrl?: string;
  companyName?: string;
}

/**
 * Candidate email confirming a scheduled interview. Built for the transition
 * into `interview_scheduled`.
 *
 * NOT WIRED YET — nothing emits the `interview_scheduled` transition until
 * interview self-scheduling (issue #33) ships. The template is ready so that
 * wiring it is a one-line change once that feature lands.
 */
export function buildInterviewConfirmationEmail(
  params: InterviewConfirmationEmailParams,
): BuiltEmail {
  const {
    candidateName,
    campaignTitle,
    interviewAt,
    prepGuideUrl,
    companyName = "the hiring team",
  } = params;
  const firstName = firstNameOf(candidateName);
  const when = formatDateTime(interviewAt);

  const subject = `Your ${campaignTitle} interview is confirmed`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your interview for the ${campaignTitle} role is confirmed for:`,
    ``,
    `  ${when}`,
    ``,
    prepGuideUrl
      ? `To help you prepare, please read the prep guide here:\n${prepGuideUrl}\n`
      : ``,
    `If you need to reschedule, just reply to this email.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Your interview for the <strong>${escapeHtml(campaignTitle)}</strong> role is confirmed for:
                </p>
                <p style="margin:0 0 24px; font-size:16px; line-height:1.6; font-weight:600; color:#0369A1;">
                  ${escapeHtml(when)}
                </p>
                ${prepGuideUrl ? renderButton(prepGuideUrl, "Read the prep guide") : ""}
                <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#6b7280;">
                  If you need to reschedule, just reply to this email.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
