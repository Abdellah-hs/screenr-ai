import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/archive/auto-archive-sweep", () => ({ sweepAutoArchive: vi.fn() }));

import { GET } from "./route";
import { sweepAutoArchive } from "@/lib/archive/auto-archive-sweep";

const mockSweep = vi.mocked(sweepAutoArchive);
const SECRET = "test-cron-secret";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/auto-archive", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = SECRET;
  mockSweep.mockResolvedValue({ scanned: 4, skipped: 1, archived: 3, failed: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/auto-archive", () => {
  it("runs the sweep and returns its totals when the secret matches", async () => {
    const res = await GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      scanned: 4,
      skipped: 1,
      archived: 3,
      failed: 0,
    });
  });

  it("rejects a wrong secret without sweeping", async () => {
    const res = await GET(request("Bearer wrong"));

    expect(res.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(request("Bearer anything"));

    expect(res.status).toBe(500);
    expect(mockSweep).not.toHaveBeenCalled();
  });
});
