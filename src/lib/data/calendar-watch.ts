import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import type { Database } from "@/types/database.types";

/**
 * Data layer for `calendar_watch_channels` — one Google `events.watch` channel
 * per recruiter, plus its incremental sync cursor and a best-effort
 * reconciliation mutex. All writes are system-driven (booking flow, webhook,
 * renewal cron), so every function runs on the admin client by default; a `db`
 * can be injected for a shared transaction/session.
 */

export type WatchChannel = Database["public"]["Tables"]["calendar_watch_channels"]["Row"];

/** The recruiter's watch channel, if one exists. */
export async function fetchWatchChannelByOwner(
  ownerUserId: string,
  db?: SupabaseDb,
): Promise<WatchChannel | null> {
  const supabase = db ?? createAdminClient();
  const { data } = await supabase
    .from("calendar_watch_channels")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  return data ?? null;
}

/** The channel a webhook notification belongs to, matched by our channel id. */
export async function fetchWatchChannelByChannelId(
  channelId: string,
  db?: SupabaseDb,
): Promise<WatchChannel | null> {
  const supabase = db ?? createAdminClient();
  const { data } = await supabase
    .from("calendar_watch_channels")
    .select("*")
    .eq("channel_id", channelId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Create or replace the recruiter's channel row (one per owner, UNIQUE
 * owner_user_id). `syncToken` is passed through so a renewal preserves the
 * existing cursor while a brand-new channel starts null (forcing a full sync).
 */
export async function upsertWatchChannel(
  params: {
    ownerUserId: string;
    channelId: string;
    resourceId: string;
    channelToken: string;
    syncToken: string | null;
    expirationIso: string | null;
  },
  db?: SupabaseDb,
): Promise<void> {
  const supabase = db ?? createAdminClient();
  const { error } = await supabase.from("calendar_watch_channels").upsert(
    {
      owner_user_id: params.ownerUserId,
      channel_id: params.channelId,
      resource_id: params.resourceId,
      channel_token: params.channelToken,
      sync_token: params.syncToken,
      expiration: params.expirationIso,
      // A replaced channel is not mid-reconcile.
      reconciling_since: null,
    },
    { onConflict: "owner_user_id" },
  );
  if (error) throw new Error(`Failed to store watch channel: ${error.message}`);
}

/** Persist the incremental-sync cursor after a reconcile (null forces full resync). */
export async function updateWatchSyncToken(
  ownerUserId: string,
  syncToken: string | null,
  db?: SupabaseDb,
): Promise<void> {
  const supabase = db ?? createAdminClient();
  const { error } = await supabase
    .from("calendar_watch_channels")
    .update({ sync_token: syncToken })
    .eq("owner_user_id", ownerUserId);
  if (error) throw new Error(`Failed to store sync token: ${error.message}`);
}

/** Channels at or past `before` — the renewal cron's work list. */
export async function fetchExpiringWatchChannels(
  before: Date,
  db?: SupabaseDb,
): Promise<WatchChannel[]> {
  const supabase = db ?? createAdminClient();
  const { data } = await supabase
    .from("calendar_watch_channels")
    .select("*")
    .lte("expiration", before.toISOString());
  return data ?? [];
}

/**
 * Best-effort per-recruiter reconciliation mutex. Conditionally stamps
 * `reconciling_since = now` only when no reconcile is running (null) or the last
 * one is older than `staleBefore` (self-healing after a crash). Returns true
 * when THIS caller took the lock. NOT the correctness guarantee — that's the
 * conditional status transitions — just a way to skip redundant Google calls
 * when webhook deliveries overlap.
 */
export async function acquireReconcileLock(
  ownerUserId: string,
  now: Date,
  staleBefore: Date,
  db?: SupabaseDb,
): Promise<boolean> {
  const supabase = db ?? createAdminClient();
  const { data, error } = await supabase
    .from("calendar_watch_channels")
    .update({ reconciling_since: now.toISOString() })
    .eq("owner_user_id", ownerUserId)
    .or(`reconciling_since.is.null,reconciling_since.lt.${staleBefore.toISOString()}`)
    .select("id");
  if (error) throw new Error(`Failed to acquire reconcile lock: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Release the reconciliation mutex (always run in a finally). */
export async function releaseReconcileLock(
  ownerUserId: string,
  db?: SupabaseDb,
): Promise<void> {
  const supabase = db ?? createAdminClient();
  const { error } = await supabase
    .from("calendar_watch_channels")
    .update({ reconciling_since: null })
    .eq("owner_user_id", ownerUserId);
  if (error) throw new Error(`Failed to release reconcile lock: ${error.message}`);
}
