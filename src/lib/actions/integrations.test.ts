import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockFetchGmailConnection,
  mockFetchGmailConnectionStatus,
  mockDeleteGmailConnection,
  mockRevokeRefreshToken,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchGmailConnection: vi.fn(),
  mockFetchGmailConnectionStatus: vi.fn(),
  mockDeleteGmailConnection: vi.fn(),
  mockRevokeRefreshToken: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/data/integrations", () => ({
  fetchGmailConnection: mockFetchGmailConnection,
  fetchGmailConnectionStatus: mockFetchGmailConnectionStatus,
  deleteGmailConnection: mockDeleteGmailConnection,
}));

vi.mock("@/lib/services/gmail", () => ({
  revokeRefreshToken: mockRevokeRefreshToken,
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
    expect(mockFetchGmailConnectionStatus).not.toHaveBeenCalled();
  });

  it("returns the connection status for the authenticated user", async () => {
    const status = { connected: true, email: "jobs@acme.com", connectedAt: "t" };
    mockFetchGmailConnectionStatus.mockResolvedValue(status);

    await expect(getGmailConnectionStatus()).resolves.toEqual(status);
    expect(mockFetchGmailConnectionStatus).toHaveBeenCalledWith("user-1");
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
