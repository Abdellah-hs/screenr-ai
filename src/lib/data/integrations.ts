import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import type { SupabaseDb } from "@/lib/supabase/types";

type GmailConnectionRow = Database["public"]["Tables"]["gmail_connections"]["Row"];
type SocialConnectionRow = Database["public"]["Tables"]["social_connections"]["Row"];

/** Connection status for the UI — never includes the refresh token. */
export type GmailConnectionStatus = {
  /** A row exists AND its refresh token was verified live. */
  connected: boolean;
  /** A row exists but Google rejected the token — the recruiter must reconnect. */
  needsReconnect: boolean;
  /**
   * The stored grant covers the calendar scopes (free/busy + events). False
   * for connections made before calendar-aware scheduling — those recruiters
   * reconnect once to upgrade.
   */
  calendarEnabled: boolean;
  email: string | null;
  connectedAt: string | null;
};

/**
 * Insert or update the recruiter's Gmail connection. One row per user
 * (UNIQUE user_id), so a reconnect with a different account overwrites in
 * place. RLS scopes the write to the current user.
 */
export async function upsertGmailConnection(input: {
  userId: string;
  email: string;
  refreshToken: string;
  scope: string | null;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("gmail_connections").upsert(
    {
      user_id: input.userId,
      email: input.email,
      refresh_token: input.refreshToken,
      scope: input.scope,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

/**
 * Full connection row including the refresh token. SERVER-ONLY — used by the
 * resume sync to build a Gmail client. Never return this to the browser.
 */
export async function fetchGmailConnection(
  userId: string,
  db?: SupabaseDb,
): Promise<GmailConnectionRow | null> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteGmailConnection(userId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("gmail_connections")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

// ─── Social connections (LinkedIn today) ─────────────────────────────────────

/** Connection status for the Settings UI — never includes the access token. */
export type SocialConnectionStatus = {
  connected: boolean;
  /** A row exists but the stored token has expired — the recruiter reconnects. */
  needsReconnect: boolean;
  accountName: string | null;
  connectedAt: string | null;
};

/**
 * Insert or update the recruiter's connection for a social provider. One row
 * per (user_id, provider), so a reconnect overwrites in place. RLS scopes the
 * write to the current user.
 */
export async function upsertSocialConnection(input: {
  userId: string;
  provider: string;
  accessToken: string;
  tokenExpiresAt: string | null;
  accountId: string | null;
  accountName: string | null;
  scope: string | null;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("social_connections").upsert(
    {
      user_id: input.userId,
      provider: input.provider,
      access_token: input.accessToken,
      token_expires_at: input.tokenExpiresAt,
      account_id: input.accountId,
      account_name: input.accountName,
      scope: input.scope,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) throw error;
}

/**
 * Full connection row including the access token. SERVER-ONLY — used by the
 * publish action. Never return this to the browser.
 */
export async function fetchSocialConnection(
  userId: string,
  provider: string,
  db?: SupabaseDb,
): Promise<SocialConnectionRow | null> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from("social_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteSocialConnection(
  userId: string,
  provider: string,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("social_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw error;
}
