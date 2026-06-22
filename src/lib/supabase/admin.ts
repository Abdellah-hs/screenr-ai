import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Service-role Supabase client — **bypasses RLS**. Server-only.
 *
 * Use this ONLY inside server actions that have already verified a candidate's
 * signed token (e.g. interview scheduling). Candidate-facing tables are
 * owner-only RLS and there are no candidate accounts, so legitimate public
 * writes go through this client after the token check — never from a browser.
 *
 * The service-role key must never reach the client bundle; importing this in a
 * Client Component will fail the build (no NEXT_PUBLIC_ prefix on the secret).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set to perform candidate-side writes.",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
