import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateAdminClient,
  mockFetchWatchChannelByChannelId,
  mockReconcileCalendarChanges,
  mockGetRequestOrigin,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockFetchWatchChannelByChannelId: vi.fn(),
  mockReconcileCalendarChanges: vi.fn(),
  mockGetRequestOrigin: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/data/calendar-watch", () => ({
  fetchWatchChannelByChannelId: mockFetchWatchChannelByChannelId,
}));
vi.mock("@/lib/scheduling/calendar-sync", () => ({
  reconcileCalendarChanges: mockReconcileCalendarChanges,
}));
vi.mock("@/lib/http/origin", () => ({ getRequestOrigin: mockGetRequestOrigin }));

import { POST } from "./route";

const CHANNEL = {
  owner_user_id: "owner-1",
  channel_id: "chan-1",
  resource_id: "res-1",
  channel_token: "tok-secret",
};

function ping(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/webhooks/google-calendar", {
    method: "POST",
    headers,
  });
}

const VALID_EXISTS = {
  "x-goog-channel-id": "chan-1",
  "x-goog-resource-id": "res-1",
  "x-goog-channel-token": "tok-secret",
  "x-goog-resource-state": "exists",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAdminClient.mockReturnValue({ __brand: "admin" });
  mockFetchWatchChannelByChannelId.mockResolvedValue(CHANNEL);
  mockReconcileCalendarChanges.mockResolvedValue({ ran: true, rescheduled: 1 });
  mockGetRequestOrigin.mockResolvedValue("https://app.example.com");
});

describe("POST /api/webhooks/google-calendar", () => {
  it("reconciles the owner's calendar on a valid 'exists' ping", async () => {
    const res = await POST(ping(VALID_EXISTS));

    expect(res.status).toBe(200);
    expect(mockReconcileCalendarChanges).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      scheduleOrigin: "https://app.example.com",
      db: { __brand: "admin" },
    });
  });

  it("acknowledges a 'sync' handshake ping without reconciling", async () => {
    const res = await POST(ping({ ...VALID_EXISTS, "x-goog-resource-state": "sync" }));

    expect(res.status).toBe(200);
    expect(mockReconcileCalendarChanges).not.toHaveBeenCalled();
  });

  it("ignores (200) a ping for an unknown channel", async () => {
    mockFetchWatchChannelByChannelId.mockResolvedValue(null);

    const res = await POST(ping(VALID_EXISTS));

    expect(res.status).toBe(200);
    expect(mockReconcileCalendarChanges).not.toHaveBeenCalled();
  });

  it("rejects (401) when the per-channel token doesn't match", async () => {
    const res = await POST(ping({ ...VALID_EXISTS, "x-goog-channel-token": "wrong" }));

    expect(res.status).toBe(401);
    expect(mockReconcileCalendarChanges).not.toHaveBeenCalled();
  });

  it("rejects (401) when the resource id doesn't match the stored channel", async () => {
    const res = await POST(ping({ ...VALID_EXISTS, "x-goog-resource-id": "res-other" }));

    expect(res.status).toBe(401);
    expect(mockReconcileCalendarChanges).not.toHaveBeenCalled();
  });

  it("rejects (401) when the token header is missing entirely", async () => {
    const { "x-goog-channel-token": _omit, ...noToken } = VALID_EXISTS;
    void _omit;

    const res = await POST(ping(noToken));

    expect(res.status).toBe(401);
    expect(mockReconcileCalendarChanges).not.toHaveBeenCalled();
  });

  it("400s a ping with no channel id", async () => {
    const res = await POST(ping({ "x-goog-resource-state": "exists" }));

    expect(res.status).toBe(400);
    expect(mockFetchWatchChannelByChannelId).not.toHaveBeenCalled();
  });
});
