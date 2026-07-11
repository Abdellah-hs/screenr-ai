import { google, type gmail_v1, type Auth } from "googleapis";

// ─── OAuth ───────────────────────────────────────────────────────────────────
// The Google OAuth *app* identity (client id/secret) lives in env — it is the
// same for every recruiter. What differs per recruiter is the refresh token,
// which is obtained via the consent flow and persisted in `gmail_connections`.

// gmail.modify is a superset of gmail.send, which is what outbound candidate
// email (screening/interview links) needs.
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";


export const CALENDAR_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";


const CONSENT_SCOPES = [GMAIL_SCOPE, CALENDAR_FREEBUSY_SCOPE, CALENDAR_EVENTS_SCOPE];

/**
 * Whether a stored grant (the space-delimited `scope` string Google returned
 * at consent) covers calendar-aware scheduling. Exact-token match — substring
 * checks would accept e.g. `calendar.events.readonly` for `calendar.events`.
 */

export function hasCalendarScopes(scope: string | null): boolean {
  if (!scope) return false;
  const granted = new Set(scope.split(/\s+/));
  return granted.has(CALENDAR_FREEBUSY_SCOPE) && granted.has(CALENDAR_EVENTS_SCOPE);
}

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
 * Requests Gmail + Calendar scopes together, so one reconnect upgrades a
 * pre-calendar connection.
 */
export function buildGmailConsentUrl(redirectUri: string, state: string): string {
  return getGoogleOAuthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CONSENT_SCOPES,
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
 * Tell a definitively-dead token (Google rejected it with `invalid_grant` —
 * revoked, expired, or password-reset) apart from a transient failure
 * (network blip, Google 5xx). Only the former means "reconnect required".
 */
function isInvalidGrantError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return (
    e.response?.data?.error === "invalid_grant" ||
    /invalid_grant/.test(e.message ?? "")
  );
}

/**
 * Verify a stored refresh token still works by minting a short-lived access
 * token from it. Returns `true` when the token is live, `false` when Google
 * rejected it as `invalid_grant` (the recruiter must reconnect). Transient
 * errors are re-thrown so callers don't flip a working connection to
 * "disconnected" over a network blip.
 */
export async function verifyRefreshToken(refreshToken: string): Promise<boolean> {
  const { clientId, clientSecret } = getOAuthCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await oauth2Client.getAccessToken();
    return Boolean(token);
  } catch (err) {
    if (isInvalidGrantError(err)) return false;
    throw err;
  }
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
 * OAuth2 client bound to a recruiter's refresh token — the shared auth object
 * for every Google API called on their behalf (Gmail, Calendar). The googleapis
 * SDK transparently mints short-lived access tokens from the refresh token, so
 * we only ever persist the refresh token.
 */
export function createGoogleAuthClient(refreshToken: string): Auth.OAuth2Client {
  const { clientId, clientSecret } = getOAuthCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/** Gmail client bound to a recruiter's refresh token. */
export function createGmailClient(refreshToken: string): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: createGoogleAuthClient(refreshToken) });
}

