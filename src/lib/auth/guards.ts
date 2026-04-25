import { createClient } from "@/lib/supabase/server";

/**
 * Action-layer auth guard. Returns the authenticated user's id, throws if
 * there is no session. Every server action that mutates or reads scoped
 * data should call this first — the data layer relies on callers having
 * resolved the user.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user.id;
}
