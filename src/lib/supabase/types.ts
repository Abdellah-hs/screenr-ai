import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * A typed Supabase client, satisfied by BOTH the cookie-scoped server client
 * (`createClient`) and the service-role admin client (`createAdminClient`).
 * Data functions that can run either in a recruiter session OR in a session-less
 * context (the public apply pipeline, cron sweeps) accept this as an optional
 * `db` param — defaulting to the session client keeps every existing caller unchanged.
 */
export type SupabaseDb = SupabaseClient<Database>;
