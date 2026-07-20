import type { gmail_v1 } from "googleapis";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { createGmailClient } from "@/lib/services/gmail";
import type { SupabaseDb } from "@/lib/supabase/types";

/**
 * Resolve the Gmail API client used to SEND candidate-facing email, built from
 * the recruiter's inbox connected in Settings → Integrations
 * (`gmail_connections`). The very same connection powers inbound resume sync —
 * one mailbox for both directions.
 *
 * The `gmail.modify` scope the recruiter granted on connect already authorizes
 * `messages.send`, so sending needs no extra consent. (This replaces the legacy
 * shared `GOOGLE_REFRESH_TOKEN` env account.)
 *
 * Throws when no inbox is connected. User-initiated callers (sending screening
 * questions) surface the message so the recruiter knows to connect one;
 * best-effort callers (transition notifications) swallow it.
 *
 * Session-less callers (candidate token flows, cron) MUST pass the admin `db` —
 * the default cookie client has no session there, and owner-only RLS would
 * silently return no connection.
 */
export async function getRecruiterGmailClient(
  userId: string,
  db?: SupabaseDb,
): Promise<gmail_v1.Gmail> {
  const connection = await fetchGmailConnection(userId, db);
  if (!connection) {
    throw new Error(
      "No Gmail connected. Connect your inbox in Settings before sending candidate emails.",
    );
  }
  return createGmailClient(connection.refresh_token);
}
