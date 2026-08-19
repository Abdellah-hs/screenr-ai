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
  /** "Join with Google Meet" link from the created calendar event, if any. */
  meetUrl?: string;
  /** Web prep-guide page (per the PRD this is a page, not a PDF). */
  prepGuideUrl?: string;
  /** IANA zone the slot was offered in, so the time reads as the candidate booked it. */
  timeZone?: string | null;
  companyName?: string;
}

/**
 * Candidate email confirming a booked final interview, sent by
 * `bookInterviewSlot` right after the slot is saved. When the Google Calendar
 * event was created, it carries the Meet join link (the candidate also gets
 * Google's own calendar invite).
 */
export function buildInterviewConfirmationEmail(
  params: InterviewConfirmationEmailParams,
): BuiltEmail {
  const {
    candidateName,
    campaignTitle,
    interviewAt,
    meetUrl,
    prepGuideUrl,
    timeZone,
    companyName = "the hiring team",
  } = params;
  const firstName = firstNameOf(candidateName);
  const when = formatDateTime(interviewAt, timeZone);

  const subject = `Your ${campaignTitle} interview is confirmed`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your interview for the ${campaignTitle} role is confirmed for:`,
    ``,
    `  ${when}`,
    ``,
    meetUrl
      ? `Join the interview on Google Meet:\n${meetUrl}\n\nYou'll also receive a calendar invite with this link.\n`
      : ``,
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
                ${meetUrl ? renderButton(meetUrl, "Join with Google Meet") : ""}
                ${
                  meetUrl
                    ? `<p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#6b7280;">
                  You&#39;ll also receive a calendar invite with this link.
                </p>`
                    : ""
                }
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
