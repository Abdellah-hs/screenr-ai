import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockFetchGmailConnection,
  mockDeleteGmailConnection,
  mockRevokeRefreshToken,
  mockVerifyRefreshToken,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchGmailConnection: vi.fn(),
  mockDeleteGmailConnection: vi.fn(),
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
}));

vi.mock("@/lib/services/gmail", () => ({
  revokeRefreshToken: mockRevokeRefreshToken,
  verifyRefreshToken: mockVerifyRefreshToken,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import { getGmailConnectionStatus, disconnectGmail } from "./integrations";

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
    });
    mockVerifyRefreshToken.mockResolvedValue(true);

    await expect(getGmailConnectionStatus()).resolves.toEqual({
      connected: true,
      needsReconnect: false,
      email: "jobs@acme.com",
      connectedAt: "2026-06-06T00:00:00Z",
    });
    expect(mockVerifyRefreshToken).toHaveBeenCalledWith("rt-1");
  });

  it("reports needsReconnect when a stored token is rejected by Google", async () => {
    mockFetchGmailConnection.mockResolvedValue({
      refresh_token: "rt-dead",
      email: "jobs@acme.com",
      connected_at: "2026-06-06T00:00:00Z",
    });
    mockVerifyRefreshToken.mockResolvedValue(false);

    await expect(getGmailConnectionStatus()).resolves.toEqual({
      connected: false,
      needsReconnect: true,
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
