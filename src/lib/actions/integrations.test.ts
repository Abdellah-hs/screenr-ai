import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockFetchGmailConnection,
  mockDeleteGmailConnection,
  mockFetchSocialConnection,
  mockDeleteSocialConnection,
  mockRevokeRefreshToken,
  mockVerifyRefreshToken,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchGmailConnection: vi.fn(),
  mockDeleteGmailConnection: vi.fn(),
  mockFetchSocialConnection: vi.fn(),
  mockDeleteSocialConnection: vi.fn(),
  mockRevokeRefreshToken: vi.fn(),
  mockVerifyRefreshToken: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/data/integrations", () => ({
  fetchGmailConnection: mockFetchGmailConnection,
  deleteGmailConnection: mockDeleteGmailConnection,
  fetchSocialConnection: mockFetchSocialConnection,
  deleteSocialConnection: mockDeleteSocialConnection,
}));

// Only the network-touching functions are mocked; `hasCalendarScopes` is pure
// and stays real so the calendarEnabled derivation is actually exercised.
vi.mock("@/lib/services/gmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/gmail")>();
  return {
    ...actual,
    revokeRefreshToken: mockRevokeRefreshToken,
    verifyRefreshToken: mockVerifyRefreshToken,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import {
  getGmailConnectionStatus,
  disconnectGmail,
  getLinkedInConnectionStatus,
  disconnectLinkedIn,
} from "./integrations";
import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
} from "@/lib/services/gmail";

const GMAIL_ONLY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const FULL_SCOPE = `${GMAIL_ONLY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
});

describe("getGmailConnectionStatus", () => {
  it("rejects unauthenticated callers before reading any data", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getGmailConnectionStatus()).rejects.toThrow("Unauthorized");
    expect(mockFetchGmailConnection).not.toHaveBeenCalled();
  });

  it("reports not connected when there is no stored connection", async () => {
    mockFetchGmailConnection.mockResolvedValue(null);

    await expect(getGmailConnectionStatus()).resolves.toEqual({
      connected: false,
      needsReconnect: false,
      calendarEnabled: false,
      email: null,
      connectedAt: null,
    });
    expect(mockVerifyRefreshToken).not.toHaveBeenCalled();
  });

  it("reports connected when the stored token verifies live", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      email: "jobs@acme.com",
      connected_at: "2026-06-06T00:00:00Z",
      scope: GMAIL_ONLY_SCOPE,
    });
    mockVerifyRefreshToken.mockResolvedValue(true);

    await expect(getGmailConnectionStatus()).resolves.toEqual({
      connected: true,
      needsReconnect: false,
      calendarEnabled: false,
      email: "jobs@acme.com",
      connectedAt: "2026-06-06T00:00:00Z",
    });
    expect(mockVerifyRefreshToken).toHaveBeenCalledWith("rt-1");
  });

  it("reports calendarEnabled when the grant covers the calendar scopes", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      email: "jobs@acme.com",
      connected_at: "2026-06-06T00:00:00Z",
      scope: FULL_SCOPE,
    });
    mockVerifyRefreshToken.mockResolvedValue(true);

    const status = await getGmailConnectionStatus();

    expect(status.connected).toBe(true);
    expect(status.calendarEnabled).toBe(true);
  });

  it("never reports calendarEnabled on a dead connection, even with calendar scopes stored", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-dead",
      email: "jobs@acme.com",
      connected_at: "2026-06-06T00:00:00Z",
      scope: FULL_SCOPE,
    });
    mockVerifyRefreshToken.mockResolvedValue(false);

    const status = await getGmailConnectionStatus();

    expect(status.calendarEnabled).toBe(false);
  });

  it("reports needsReconnect when a stored token is rejected by Google", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-dead",
      email: "jobs@acme.com",
      connected_at: "2026-06-06T00:00:00Z",
      scope: GMAIL_ONLY_SCOPE,
    });
    mockVerifyRefreshToken.mockResolvedValue(false);

    await expect(getGmailConnectionStatus()).resolves.toEqual({
      connected: false,
      needsReconnect: true,
      calendarEnabled: false,
      email: "jobs@acme.com",
      connectedAt: "2026-06-06T00:00:00Z",
    });
  });

  it("stays connected (optimistic) when verification throws a transient error", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-1",
      email: "jobs@acme.com",
      connected_at: "2026-06-06T00:00:00Z",
    });
    mockVerifyRefreshToken.mockRejectedValue(new Error("ETIMEDOUT"));

    const status = await getGmailConnectionStatus();

    expect(status.connected).toBe(true);
    expect(status.needsReconnect).toBe(false);
  });
});

describe("disconnectGmail", () => {
  it("rejects unauthenticated callers before deleting anything", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(disconnectGmail()).rejects.toThrow("Unauthorized");
    expect(mockDeleteGmailConnection).not.toHaveBeenCalled();
  });

  it("revokes the token then deletes the connection when one exists", async () => {
    mockFetchGmailConnection.mockResolvedValue({ refresh_token: "rt-1" });
    mockRevokeRefreshToken.mockResolvedValue(undefined);

    const result = await disconnectGmail();

    expect(mockRevokeRefreshToken).toHaveBeenCalledWith("rt-1");
    expect(mockDeleteGmailConnection).toHaveBeenCalledWith("user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
    expect(result).toEqual({ success: true });
  });

  it("still deletes the connection when token revocation fails (non-fatal)", async () => {
    mockFetchGmailConnection.mockResolvedValue({ refresh_token: "rt-1" });
    mockRevokeRefreshToken.mockRejectedValue(new Error("google 400"));

    const result = await disconnectGmail();

    expect(mockDeleteGmailConnection).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({ success: true });
  });

  it("does nothing to revoke/delete when there is no connection", async () => {
    mockFetchGmailConnection.mockResolvedValue(null);

    const result = await disconnectGmail();

    expect(mockRevokeRefreshToken).not.toHaveBeenCalled();
    expect(mockDeleteGmailConnection).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
    expect(result).toEqual({ success: true });
  });
});

describe("getLinkedInConnectionStatus", () => {
  it("rejects unauthenticated callers before reading any data", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getLinkedInConnectionStatus()).rejects.toThrow("Unauthorized");
    expect(mockFetchSocialConnection).not.toHaveBeenCalled();
  });

  it("reports not connected when there is no stored connection", async () => {
    mockFetchSocialConnection.mockResolvedValue(null);

    await expect(getLinkedInConnectionStatus()).resolves.toEqual({
      connected: false,
      needsReconnect: false,
      accountName: null,
      connectedAt: null,
    });
  });

  it("reports connected when the stored token has not expired", async () => {
    mockFetchSocialConnection.mockResolvedValue({
      access_token: "tok-1",
      account_name: "Ada Lovelace",
      account_id: "member-9",
      token_expires_at: "2999-01-01T00:00:00.000Z",
      connected_at: "2026-07-22T00:00:00Z",
    });

    const status = await getLinkedInConnectionStatus();

    expect(status.connected).toBe(true);
    expect(status.needsReconnect).toBe(false);
    expect(status.accountName).toBe("Ada Lovelace");
  });

  it("reports needsReconnect when the stored token has expired", async () => {
    mockFetchSocialConnection.mockResolvedValue({
      access_token: "tok-1",
      account_name: "Ada Lovelace",
      account_id: "member-9",
      token_expires_at: "2000-01-01T00:00:00.000Z",
      connected_at: "2026-07-22T00:00:00Z",
    });

    const status = await getLinkedInConnectionStatus();

    expect(status.connected).toBe(false);
    expect(status.needsReconnect).toBe(true);
  });

  it("degrades to not connected when the read fails (e.g. table not migrated yet)", async () => {
    mockFetchSocialConnection.mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { code: "42P01" }),
    );

    await expect(getLinkedInConnectionStatus()).resolves.toEqual({
      connected: false,
      needsReconnect: false,
      accountName: null,
      connectedAt: null,
    });
  });
});

describe("disconnectLinkedIn", () => {
  it("rejects unauthenticated callers before deleting anything", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(disconnectLinkedIn()).rejects.toThrow("Unauthorized");
    expect(mockDeleteSocialConnection).not.toHaveBeenCalled();
  });

  it("deletes the linkedin connection and revalidates settings", async () => {
    mockDeleteSocialConnection.mockResolvedValue(undefined);

    const result = await disconnectLinkedIn();

    expect(mockDeleteSocialConnection).toHaveBeenCalledWith("user-1", "linkedin");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
    expect(result).toEqual({ success: true });
  });
});
