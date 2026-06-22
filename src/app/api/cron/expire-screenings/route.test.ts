import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/screening/expiry-sweep", () => ({
  sweepExpiredScreenings: vi.fn(),
}));

import { GET } from "./route";
import { sweepExpiredScreenings } from "@/lib/screening/expiry-sweep";

const mockSweep = vi.mocked(sweepExpiredScreenings);
const SECRET = "test-cron-secret";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/expire-screenings", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = SECRET;
  mockSweep.mockResolvedValue({ scanned: 3, expired: 3, failed: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/expire-screenings", () => {
  it("runs the sweep and returns its totals when the secret matches", async () => {
    const res = await GET(request(`Bearer ${SECRET}`));

    expect(mockSweep).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      scanned: 3,
      expired: 3,
      failed: 0,
    });
  });

  it("rejects a request with the wrong secret without sweeping", async () => {
    const res = await GET(request("Bearer wrong"));

    expect(res.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("rejects a request with no authorization header", async () => {
    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(request("Bearer anything"));

    expect(res.status).toBe(500);
    expect(mockSweep).not.toHaveBeenCalled();
  });
});
