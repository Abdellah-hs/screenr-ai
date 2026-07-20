import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRenew, mockGetRequestOrigin } = vi.hoisted(() => ({
  mockRenew: vi.fn(),
  mockGetRequestOrigin: vi.fn(),
}));

vi.mock("@/lib/scheduling/calendar-sync", () => ({
  renewExpiringWatchChannels: mockRenew,
  GOOGLE_CALENDAR_WEBHOOK_PATH: "/api/webhooks/google-calendar",
}));
vi.mock("@/lib/http/origin", () => ({ getRequestOrigin: mockGetRequestOrigin }));

import { GET } from "./route";

const SECRET = "test-cron-secret";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/renew-calendar-watches", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = SECRET;
  mockGetRequestOrigin.mockResolvedValue("https://app.example.com");
  mockRenew.mockResolvedValue({ scanned: 2, renewed: 2, failed: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/renew-calendar-watches", () => {
  it("renews channels with the absolute webhook URL and returns totals", async () => {
    const res = await GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(mockRenew).toHaveBeenCalledWith({
      webhookUrl: "https://app.example.com/api/webhooks/google-calendar",
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      scanned: 2,
      renewed: 2,
      failed: 0,
    });
  });

  it("rejects the wrong secret without renewing", async () => {
    const res = await GET(request("Bearer wrong"));

    expect(res.status).toBe(401);
    expect(mockRenew).not.toHaveBeenCalled();
  });

  it("rejects a request with no authorization header", async () => {
    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mockRenew).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(request("Bearer anything"));

    expect(res.status).toBe(500);
    expect(mockRenew).not.toHaveBeenCalled();
  });
});
