import { getGmailClient } from "./gmail";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}

/**
 * Send an email via the Gmail API using the same OAuth2 credentials
 * that drive resume ingestion. The "From" address is whatever the
 * authenticated Google account is; `fromName` controls the display name.
 *
 * Returns the Gmail messageId so callers can log or reference it.
 */
export async function sendEmail(params: SendEmailParams): Promise<string> {
  const { to, subject, html, text, fromName = "Screenr AI" } = params;

  const gmail = getGmailClient();

  // Build a minimal multipart/alternative MIME message. The Gmail API
  // accepts a base64url-encoded raw RFC 2822 message.
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  const mime = [
    `From: ${fromName} <me>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  const raw = Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return res.data.id ?? "";
  } catch (err: unknown) {
    // Surface a human-readable message for the common OAuth failure modes
    // so recruiters see what to do instead of a raw "invalid_grant" string.
    const e = err as { message?: string; response?: { data?: { error?: string } } };
    const oauthError = e.response?.data?.error ?? e.message ?? "";
    if (
      oauthError.includes("invalid_grant") ||
      oauthError.includes("Token has been expired or revoked")
    ) {
      throw new Error(
        "Gmail authorization has expired. The recruiter needs to regenerate GOOGLE_REFRESH_TOKEN — see the screening-questions setup guide."
      );
    }
    if (oauthError.includes("invalid_client")) {
      throw new Error(
        "Gmail OAuth client credentials are invalid. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local."
      );
    }
    throw new Error(
      `Failed to send email via Gmail: ${e.message ?? "unknown error"}`
    );
  }
}
