"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import {
  fetchGmailConnection,
  deleteGmailConnection,
  type GmailConnectionStatus,
} from "@/lib/data/integrations";
import {
  hasCalendarScopes,
  revokeRefreshToken,
  verifyRefreshToken,
} from "@/lib/services/gmail";

/**
 * Read the current recruiter's Gmail connection status for the Settings page.
 * A stored row is not enough — the refresh token is verified live so a revoked
 * or expired connection surfaces as "needs reconnect" instead of a stale
 * "Connected". The token never leaves the server.
 */
export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
  const userId = await requireUserId();

  const connection = await fetchGmailConnection(userId);
  if (!connection) {
    return {
      connected: false,
      needsReconnect: false,
      calendarEnabled: false,
      email: null,
      connectedAt: null,
    };
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
