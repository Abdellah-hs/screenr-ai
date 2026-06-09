import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/guards";
import { buildGmailConsentUrl } from "@/lib/services/gmail";

const STATE_COOKIE = "gmail_oauth_state";

/**
 * Start the Gmail OAuth flow. Authenticated recruiters only. Sets a short-lived
 * CSRF `state` cookie and redirects to Google's consent screen. The recruiter
 * returns to /api/integrations/gmail/callback once they approve.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  try {
    await requireUserId();
  } catch {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = `${origin}/api/integrations/gmail/callback`;
  const state = randomBytes(16).toString("hex");
  const consentUrl = buildGmailConsentUrl(redirectUri, state);

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
