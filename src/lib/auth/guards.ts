import { cache } from "react";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The authenticated user, fetched at most once per request.
 *
 * `supabase.auth.getUser()` is a **network call** to the Auth server — that is
 * the point of it, since unlike `getSession()` it verifies the JWT rather than
 * trusting the cookie. It is also the first line of nearly every action, so a
 * page paid for it once per action it invoked: the candidate detail page fired
 * seven concurrently, and the campaigns list chained two of them behind each
 * other. The answer cannot change inside a single request, so `cache()` scopes
 * it to the request — the first caller pays the round trip, the rest read the
 * memo.
 *
 * The cache is per request, not per process: it is React's request-scoped
 * memo, so one recruiter's session can never be served to another.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Action-layer auth guard. Returns the authenticated user's id, throws if
 * there is no session. Every server action that mutates or reads scoped
 * data should call this first — the data layer relies on callers having
 * resolved the user.
 */
export async function requireUserId(): Promise<string> {
  const user = await getAuthUser();
  if (!user) throw new Error("Unauthorized");
  return user.id;
}

/**
 * The guard on every machine-driven route: the agent workers and the scheduled
 * sweeps, neither of which has a session to check.
 *
 * Returns the response to send, or `null` when the caller is authorised —
 * `const denied = requireBearerSecret(...); if (denied) return denied;`
 *
 * **Fails closed.** An unset secret is a 500, never an open endpoint: these
 * routes write candidate transcripts and transition applications, so a missing
 * environment variable must show up in the deploy log rather than as a door.
 *
 * This was twelve independent transcriptions of the same eight lines, one per
 * route. That is twelve chances for the next one to compare with `includes`,
 * forget the unset branch, or drop the 500/401 split — on the only
 * authentication boundary the machine callers have.
 */
export function requireBearerSecret(
  request: Request,
  envVar: "AGENT_API_SECRET" | "CRON_SECRET",
  refusing: string,
): NextResponse | null {
  const secret = process.env[envVar];
  if (!secret) {
    console.error(`${envVar} is not configured; refusing ${refusing}.`);
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
