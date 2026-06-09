"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import {
  fetchGmailConnection,
  fetchGmailConnectionStatus,
  deleteGmailConnection,
  type GmailConnectionStatus,
} from "@/lib/data/integrations";
import { revokeRefreshToken } from "@/lib/services/gmail";

/**
 * Read the current recruiter's Gmail connection status for the Settings page.
 * Token-free by construction (see fetchGmailConnectionStatus).
 */
export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
  const userId = await requireUserId();
  return fetchGmailConnectionStatus(userId);
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
