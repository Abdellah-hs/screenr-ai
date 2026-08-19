import {
  escapeHtml,
  firstNameOf,
  formatDateTime,
  renderButton,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface InterviewReminderEmailParams {
  candidateName: string;
  campaignTitle: string;
  interviewAt: Date;
  /** Join link for the interview session. */
  joinUrl?: string;
  /** IANA zone the slot was offered in, so the time reads as the candidate booked it. */
  timeZone?: string | null;
  companyName?: string;
}

/**
 * Candidate reminder ahead of a booked final interview (the 24h / 1h nudges),
 * sent by `sweepInterviewReminders` on a schedule.
 *
 * One reminder is sent per pass at most — see `dueInterviewReminders` for which
 * one and why. The wording is deliberately lead-agnostic ("coming up", not
 * "tomorrow"), because a missed cron run means the 24h notice can land at 13
 * hours out, and copy that names a time it can't guarantee reads as a mistake.
 */
export function buildInterviewReminderEmail(
  params: InterviewReminderEmailParams,
): BuiltEmail {
  const {
    candidateName,
    campaignTitle,
    interviewAt,
    joinUrl,
    timeZone,
    companyName = "the hiring team",
  } = params;
  const firstName = firstNameOf(candidateName);
  const when = formatDateTime(interviewAt, timeZone);

  const subject = `Reminder: your ${campaignTitle} interview is coming up`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `This is a friendly reminder that your interview for the ${campaignTitle} role is coming up:`,
    ``,
    `  ${when}`,
    ``,
    joinUrl ? `Join here when it's time:\n${joinUrl}\n` : ``,
    `If something has changed and you can no longer make it, please reply to this email as soon as you can.`,
    ``,
    `Good luck,`,
    `${companyName}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  This is a friendly reminder that your interview for the <strong>${escapeHtml(campaignTitle)}</strong> role is coming up:
                </p>
                <p style="margin:0 0 24px; font-size:16px; line-height:1.6; font-weight:600; color:#0369A1;">
                  ${escapeHtml(when)}
                </p>
                ${joinUrl ? renderButton(joinUrl, "Join the interview") : ""}
                <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#6b7280;">
                  If something has changed and you can no longer make it, please reply to this email as soon as you can.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Good luck,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
