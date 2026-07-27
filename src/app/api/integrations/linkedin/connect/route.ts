import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/guards";
import { buildLinkedInConsentUrl } from "@/lib/services/linkedin";

const STATE_COOKIE = "linkedin_oauth_state";

/**
 * Start the LinkedIn OAuth flow. Authenticated recruiters only. Sets a
 * short-lived CSRF `state` cookie and redirects to LinkedIn's consent screen.
 * The recruiter returns to /api/integrations/linkedin/callback once they
 * approve. If the app credentials aren't configured, the consent-URL build
 * throws and we bounce back to Settings with an error flag (fail closed).
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  try {
    await requireUserId();
  } catch {
    return NextResponse.redirect(`${origin}/login`);
  }

  const state = randomBytes(16).toString("hex");

  let consentUrl: string;
  try {
    const redirectUri = `${origin}/api/integrations/linkedin/callback`;
    consentUrl = buildLinkedInConsentUrl(redirectUri, state);
  } catch (err) {
    console.error("LinkedIn connect failed to build consent URL:", err);
    return NextResponse.redirect(`${origin}/settings?linkedin=error`);
  }

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
