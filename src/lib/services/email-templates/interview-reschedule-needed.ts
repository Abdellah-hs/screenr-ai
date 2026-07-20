import {
  escapeHtml,
  firstNameOf,
  renderButton,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface InterviewRescheduleNeededEmailParams {
  candidateName: string;
  campaignTitle: string;
  /** Token-gated /schedule page (their existing link) to pick a new slot. */
  scheduleUrl: string;
  companyName?: string;
}

/**
 * Candidate email sent when the interviewer moved the confirmed time on their
 * own calendar, so the previously-booked slot no longer holds. Sends them back
 * to the SAME scheduling link to actively pick a new time — deliberately not
 * the initial booking or the confirmation template, since neither is honest
 * about "your time changed and you need to choose again".
 */
export function buildInterviewRescheduleNeededEmail(
  params: InterviewRescheduleNeededEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, scheduleUrl, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `Please pick a new time for your ${campaignTitle} interview`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `We need to change the time of your ${campaignTitle} interview — the slot you picked is no longer available.`,
    ``,
    `Please choose a new time that works for you here:`,
    scheduleUrl,
    ``,
    `Sorry for the shuffle, and thanks for your flexibility.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  We need to change the time of your <strong>${escapeHtml(campaignTitle)}</strong> interview — the slot you picked is no longer available.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  Please choose a new time that works for you:
                </p>
                ${renderButton(scheduleUrl, "Pick a new time")}
                <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#6b7280;">
                  Sorry for the shuffle, and thanks for your flexibility.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
