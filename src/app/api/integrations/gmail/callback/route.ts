import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/guards";
import {
  exchangeCodeForTokens,
  getConnectedEmail,
} from "@/lib/services/gmail";
import { upsertGmailConnection } from "@/lib/data/integrations";

const STATE_COOKIE = "gmail_oauth_state";

/**
 * OAuth callback. Verifies the CSRF `state`, exchanges the code for a refresh
 * token, resolves the connected email, and persists the connection for the
 * current recruiter. Always redirects back to Settings with a status flag.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const settings = (status: string) => `${origin}/settings?gmail=${status}`;

  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.split("=")[1];

  const clearState = (res: NextResponse) => {
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  // User denied consent, or CSRF state missing/mismatched.
  if (error || !code || !state || !expectedState || state !== expectedState) {
    return clearState(NextResponse.redirect(settings("error")));
  }

  try {
    const userId = await requireUserId();
    const redirectUri = `${origin}/api/integrations/gmail/callback`;

    const { refreshToken, scope } = await exchangeCodeForTokens(redirectUri, code);
    const email = await getConnectedEmail(refreshToken);

    await upsertGmailConnection({ userId, email, refreshToken, scope });

    return clearState(NextResponse.redirect(settings("connected")));
  } catch (err) {
    console.error("Gmail OAuth callback failed:", err);
    return clearState(NextResponse.redirect(settings("error")));
  }
}
