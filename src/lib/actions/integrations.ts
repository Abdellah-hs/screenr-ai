"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import {
  fetchGmailConnection,
  deleteGmailConnection,
  fetchSocialConnection,
  deleteSocialConnection,
  type GmailConnectionStatus,
  type SocialConnectionStatus,
} from "@/lib/data/integrations";
import {
  hasCalendarScopes,
  revokeRefreshToken,
  verifyRefreshToken,
} from "@/lib/services/gmail";
import { LINKEDIN_PROVIDER } from "@/lib/services/linkedin";

/**
 * Read the current recruiter's Gmail connection status for the Settings page.
 * A stored row is not enough — the refresh token is verified live so a revoked
 * or expired connection surfaces as "needs reconnect" instead of a stale
 * "Connected". The token never leaves the server.
 */
export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
  const userId = await requireUserId();

  const disconnected: GmailConnectionStatus = {
    connected: false,
    needsReconnect: false,
    calendarEnabled: false,
    email: null,
    connectedAt: null,
  };

  let connection;
  try {
    connection = await fetchGmailConnection(userId);
  } catch (err) {
    // This status renders on Settings; a DB read failure must not crash it.
    console.warn(
      "getGmailConnectionStatus: could not read connection (treating as not connected):",
      err,
    );
    return disconnected;
  }
  if (!connection) {
    return disconnected;
  }

  let connected = true;
  try {
    connected = await verifyRefreshToken(connection.refresh_token);
  } catch (err) {
    // Transient failure (network/Google 5xx): stay optimistic rather than flap
    // a working connection to "reconnect" on a blip.
    console.warn("getGmailConnectionStatus: token verification failed (transient):", err);
  }

  return {
    connected,
    needsReconnect: !connected,
    calendarEnabled: connected && hasCalendarScopes(connection.scope),
    email: connection.email,
    connectedAt: connection.connected_at,
  };
}

/**
 * Disconnect the recruiter's Gmail account: best-effort revoke the token with
 * Google, then delete the local connection row. Revocation failures are
 * non-fatal — the local row is removed regardless so the UI reflects the
 * disconnect.
 */
export async function disconnectGmail(): Promise<{ success: boolean }> {
  const userId = await requireUserId();

  const connection = await fetchGmailConnection(userId);
  if (connection) {
    try {
      await revokeRefreshToken(connection.refresh_token);
    } catch (err) {
      console.warn("disconnectGmail: token revocation failed (non-blocking):", err);
    }
    await deleteGmailConnection(userId);
  }

  revalidatePath("/settings");
  return { success: true };
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

/**
 * Read the current recruiter's LinkedIn connection status for Settings. A
 * stored token that has passed its expiry surfaces as "needs reconnect" (no
 * silent refresh — LinkedIn refresh tokens need extra app approval). The token
 * never leaves the server.
 */
export async function getLinkedInConnectionStatus(): Promise<SocialConnectionStatus> {
  const userId = await requireUserId();

  const disconnected: SocialConnectionStatus = {
    connected: false,
    needsReconnect: false,
    accountName: null,
    connectedAt: null,
  };

  let connection;
  try {
    connection = await fetchSocialConnection(userId, LINKEDIN_PROVIDER);
  } catch (err) {
    // This status renders on the campaign + settings pages, so it must never
    // crash them. If the table is missing (migration not applied yet) or the DB
    // read fails transiently, degrade to "not connected" instead of throwing.
    console.warn(
      "getLinkedInConnectionStatus: could not read connection (treating as not connected):",
      err,
    );
    return disconnected;
  }

  if (!connection) {
    return disconnected;
  }

  const expired =
    connection.token_expires_at != null &&
    new Date(connection.token_expires_at).getTime() <= Date.now();

  return {
    connected: !expired,
    needsReconnect: expired,
    accountName: connection.account_name,
    connectedAt: connection.connected_at,
  };
}

/**
 * Disconnect the recruiter's LinkedIn account: delete the local connection row.
 * (LinkedIn has no token-revocation endpoint for member tokens; letting it
 * lapse is the documented path.)
 */
export async function disconnectLinkedIn(): Promise<{ success: boolean }> {
  const userId = await requireUserId();
  await deleteSocialConnection(userId, LINKEDIN_PROVIDER);
  revalidatePath("/settings");
  return { success: true };
}
