import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/services/realtime", () => ({ createRealtimeSession: vi.fn() }));

import { startVoiceSpikeSession } from "./realtime";
import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRealtimeSession } from "@/lib/services/realtime";

const mockRequireUserId = vi.mocked(requireUserId);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockCreateRealtimeSession = vi.mocked(createRealtimeSession);

describe("startVoiceSpikeSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects an unauthenticated caller before minting a session", async () => {
    mockRequireUserId.mockRejectedValue(new Error("Unauthorized"));

    await expect(startVoiceSpikeSession()).rejects.toThrow("Unauthorized");
    expect(mockCreateRealtimeSession).not.toHaveBeenCalled();
  });

  it("rate-limits before minting a session", async () => {
    mockRequireUserId.mockResolvedValue("user-1");
    mockCheckRateLimit.mockImplementation(() => {
      throw new Error("Rate limit exceeded");
    });

    await expect(startVoiceSpikeSession()).rejects.toThrow("Rate limit exceeded");
    expect(mockCreateRealtimeSession).not.toHaveBeenCalled();
  });

  it("returns the minted session for an authenticated, within-limit caller", async () => {
    mockRequireUserId.mockResolvedValue("user-1");
    const session = { clientSecret: "ek_x", expiresAt: 123, model: "gpt-4o-realtime-preview" };
    mockCreateRealtimeSession.mockResolvedValue(session);

    await expect(startVoiceSpikeSession()).resolves.toEqual(session);
    expect(mockCheckRateLimit).toHaveBeenCalledWith("user-1", expect.objectContaining({ name: "realtime-session" }));
  });
});
