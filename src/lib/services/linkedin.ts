// ─── LinkedIn "Share on LinkedIn" integration ────────────────────────────────
// Publishes a member feed post ("we're hiring…") on the recruiter's behalf via
// the w_member_social permission. The OAuth *app* identity (client id/secret)
// lives in env — the same for every recruiter; what differs per recruiter is
// the access token obtained through consent and stored in social_connections.
//
// SETUP (one-time, done by the operator, not code):
//   1. Create a LinkedIn app (linkedin.com/developers) and request the
//      "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" products.
//   2. Set LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET in env.
//   3. Register the redirect URL `<origin>/api/integrations/linkedin/callback`.
// Until the app is approved and credentials are set, the Connect flow fails
// closed (the button surfaces an error) and nothing else breaks.

const AUTHORIZATION_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";

/** The provider key stored in social_connections.provider for LinkedIn. */
export const LINKEDIN_PROVIDER = "linkedin";

// openid+profile → read the member id (`sub`) via /userinfo; w_member_social →
// post to the member's feed.
const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

// LinkedIn access tokens are long-lived (~60 days) and refresh tokens require
// extra approval, so we store the access token + expiry and prompt a reconnect
// once it lapses — no silent refresh.
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing LinkedIn OAuth app credentials: set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET",
    );
  }
  return { clientId, clientSecret };
}

/** Whether the LinkedIn app credentials are configured (Connect is usable). */
export function isLinkedInConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

/**
 * The LinkedIn consent URL the recruiter is redirected to from Settings.
 * `redirectUri` must exactly match a redirect URL registered on the app.
 */
export function buildLinkedInConsentUrl(redirectUri: string, state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

export interface LinkedInToken {
  accessToken: string;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
  scope: string | null;
}

/**
 * Exchange the authorization code from the callback for an access token.
 * Throws with LinkedIn's error body on failure.
 */
export async function exchangeLinkedInCode(
  redirectUri: string,
  code: string,
): Promise<LinkedInToken> {
  const { clientId, clientSecret } = getCredentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new Error("LinkedIn did not return an access token.");
  }

  const ttl = json.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    scope: json.scope ?? null,
  };
}

export interface LinkedInProfile {
  /** The member id (`sub`) — the author URN is `urn:li:person:<memberId>`. */
  memberId: string;
  name: string | null;
}

/**
 * Read the connected member's id and display name via the OpenID userinfo
 * endpoint. The member id is required to author a post.
 */
export async function fetchLinkedInProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LinkedIn profile fetch failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { sub?: string; name?: string };
  if (!json.sub) {
    throw new Error("LinkedIn profile response had no member id.");
  }
  return { memberId: json.sub, name: json.name ?? null };
}

/**
 * Publish a plain-text post to the connected member's feed via the ugcPosts
 * endpoint — plain commentary, no "Little Text" escaping to worry about.
 * Returns the created post's URN (from the response header) when present.
 * Throws with LinkedIn's error body on failure so the caller can surface it.
 */
export async function publishLinkedInText(params: {
  accessToken: string;
  memberId: string;
  text: string;
}): Promise<{ postUrn: string | null }> {
  const res = await fetch(UGC_POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${params.memberId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: params.text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });

  if (!res.ok) {
    throw new Error(`LinkedIn post failed (${res.status}): ${await res.text()}`);
  }

  const postUrn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  return { postUrn };
}
