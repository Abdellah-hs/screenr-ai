import {
  escapeHtml,
  firstNameOf,
  renderButton,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";
import { INTERVIEW_DURATION_MINUTES } from "@/lib/constants";

export interface InterviewInviteEmailParams {
  candidateName: string;
  campaignTitle: string;
  /** Token-gated /interview page where the candidate takes the AI interview. */
  interviewUrl: string;
  /** Web prep-guide page (per the PRD this is a page, not a PDF). */
  prepGuideUrl?: string;
  /** ISO deadline after which the link lapses. */
  expiresAt?: string;
  companyName?: string;
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Candidate email on advancing to `interview_invited`: invites them to take the
 * on-demand AI video interview via a token link with a deadline. Unlike a human
 * interview there's no slot to book — the AI interviewer is available 24/7, so
 * the candidate simply starts when ready. The copy sets expectations the client
 * enforces: it's a video call (camera + mic) and desktop-only.
 */
export function buildInterviewInviteEmail(params: InterviewInviteEmailParams): BuiltEmail {
  const {
    candidateName,
    campaignTitle,
    interviewUrl,
    prepGuideUrl,
    expiresAt,
    companyName = "the hiring team",
  } = params;
  const firstName = firstNameOf(candidateName);
  const deadline = expiresAt ? formatDeadline(expiresAt) : null;

  const subject = `Your ${campaignTitle} interview — start when you're ready`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Great news — your screening for the ${campaignTitle} role stood out, and we'd like to move you forward to an AI-led video interview.`,
    ``,
    `You can take it whenever you're ready — there's no time slot to book. Start here:`,
    interviewUrl,
    ``,
    `A few things to know before you start:`,
    `- It's a video interview, so you'll need a working camera and microphone.`,
    `- Please use a desktop or laptop computer (not a phone).`,
    `- Find a quiet, well-lit space and set aside about ${INTERVIEW_DURATION_MINUTES} minutes.`,
    deadline ? `- Please complete it by ${deadline}.` : ``,
    ...(prepGuideUrl
      ? [
          ``,
          `Not sure what to expect? Read the prep guide first — it takes two minutes:`,
          prepGuideUrl,
        ]
      : []),
    ``,
    `Thanks,`,
    `${companyName}`,
  ]
    .filter((line) => line !== ``)
    .join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Great news — your screening for the <strong>${escapeHtml(campaignTitle)}</strong> role stood out, and we&#39;d like to move you forward to an AI-led video interview.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  You can take it whenever you&#39;re ready — there&#39;s no time slot to book. Just start when it suits you:
                </p>
                ${renderButton(interviewUrl, "Start your interview")}
                <p style="margin:24px 0 8px; font-size:15px; line-height:1.6;">A few things to know before you start:</p>
                <ul style="margin:0 0 16px; padding-left:20px; font-size:15px; line-height:1.6;">
                  <li>It&#39;s a video interview, so you&#39;ll need a working camera and microphone.</li>
                  <li>Please use a desktop or laptop computer (not a phone).</li>
                  <li>Find a quiet, well-lit space and set aside about ${INTERVIEW_DURATION_MINUTES} minutes.</li>
                  ${deadline ? `<li>Please complete it by <strong>${escapeHtml(deadline)}</strong>.</li>` : ``}
                </ul>
                ${
                  prepGuideUrl
                    ? `<p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Not sure what to expect? <a href="${escapeHtml(prepGuideUrl)}" style="color:#0369a1;">Read the prep guide</a> — it takes about two minutes.
                </p>`
                    : ``
                }
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
