import { google, type gmail_v1, type Auth } from "googleapis";

const SUPPORTED_RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isSupportedResumeMimeType(mimeType: string): boolean {
  return SUPPORTED_RESUME_MIME_TYPES.has(mimeType);
}

// ─── OAuth ───────────────────────────────────────────────────────────────────
// The Google OAuth *app* identity (client id/secret) lives in env — it is the
// same for every recruiter. What differs per recruiter is the refresh token,
// which is obtained via the consent flow and persisted in `gmail_connections`.

// gmail.modify covers reading messages AND marking them read (markGmailMessageAsRead).
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Google OAuth app credentials: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Build an OAuth2 client for the app. `redirectUri` must exactly match one of
 * the Authorized redirect URIs registered in the Google Cloud OAuth client.
 */
export function getGoogleOAuthClient(redirectUri: string): Auth.OAuth2Client {
  const { clientId, clientSecret } = getOAuthCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * The Google consent URL the recruiter is redirected to from Settings.
 * `access_type: offline` + `prompt: consent` guarantees a refresh_token is
 * returned every time (including on reconnect with a different account).
 */
export function buildGmailConsentUrl(redirectUri: string, state: string): string {
  return getGoogleOAuthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_SCOPE],
    state,
    include_granted_scopes: true,
  });
}

/**
 * Exchange the authorization code from the OAuth callback for tokens. Returns
 * the long-lived refresh_token (the only thing we persist) and granted scope.
 * Throws if Google did not return a refresh_token.
 */
export async function exchangeCodeForTokens(
  redirectUri: string,
  code: string,
): Promise<{ refreshToken: string; scope: string | null }> {
  const oauth2Client = getGoogleOAuthClient(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect and reconnect to grant offline access.",
    );
  }
  return { refreshToken: tokens.refresh_token, scope: tokens.scope ?? null };
}

/**
 * Look up the email address of the connected mailbox. Works under gmail.modify
 * (no extra userinfo scope needed).
 */
export async function getConnectedEmail(refreshToken: string): Promise<string> {
  const gmail = createGmailClient(refreshToken);
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) throw new Error("Could not read the connected Gmail address.");
  return email;
}

/**
 * Best-effort revocation of a refresh token (called on Disconnect). Failures
 * are swallowed by the caller — the local connection row is deleted regardless.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  // redirect_uri is irrelevant for revocation; any registered value is fine.
  const oauth2Client = getGoogleOAuthClient("urn:ietf:wg:oauth:2.0:oob");
  await oauth2Client.revokeToken(refreshToken);
}

/**
 * Build a Gmail client bound to a recruiter's refresh token. The googleapis
 * SDK transparently mints short-lived access tokens from the refresh token, so
 * we only ever persist the refresh token.
 */
export function createGmailClient(refreshToken: string): gmail_v1.Gmail {
  const { clientId, clientSecret } = getOAuthCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ─── Inbox operations ────────────────────────────────────────────────────────
// Each takes a pre-built `gmail` client so the connected account is resolved
// once per sync (in the action layer) and threaded through.

export async function fetchUnreadGmailResumes(
  gmail: gmail_v1.Gmail,
  maxResults: number = 5,
) {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread has:attachment (filename:pdf OR filename:docx)",
    maxResults,
  });

  return res.data.messages || [];
}

export async function getGmailMessage(gmail: gmail_v1.Gmail, messageId: string) {
  const msgData = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
  });
  return msgData.data;
}

export async function getGmailAttachmentBuffer(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
) {
  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  if (!attachment.data.data) return null;
  return Buffer.from(attachment.data.data, "base64");
}

export async function markGmailMessageAsRead(gmail: gmail_v1.Gmail, messageId: string) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}
