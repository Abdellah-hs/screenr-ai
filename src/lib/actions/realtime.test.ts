import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/guards", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/data/campaigns", () => ({ fetchCampaignById: vi.fn() }));
vi.mock("@/lib/data/screening-questions", () => ({ fetchScreeningQuestionsByCampaignId: vi.fn() }));
// Partial mock: keep the real buildScreeningInstructions, stub the network call.
vi.mock("@/lib/services/realtime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/services/realtime")>()),
  createRealtimeSession: vi.fn(),
}));

import { startVoiceSpikeSession, startScreeningPreviewSession } from "./realtime";
import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchCampaignById } from "@/lib/data/campaigns";
import { fetchScreeningQuestionsByCampaignId } from "@/lib/data/screening-questions";
import { createRealtimeSession } from "@/lib/services/realtime";

const mockRequireUserId = vi.mocked(requireUserId);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockFetchCampaignById = vi.mocked(fetchCampaignById);
const mockFetchQuestions = vi.mocked(fetchScreeningQuestionsByCampaignId);
const mockCreateRealtimeSession = vi.mocked(createRealtimeSession);

const UUID = "11111111-1111-4111-8111-111111111111";

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

describe("startScreeningPreviewSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireUserId.mockResolvedValue("user-1");
  });

  it("rejects a non-UUID campaign id", async () => {
    await expect(startScreeningPreviewSession("not-a-uuid")).rejects.toThrow();
    expect(mockCreateRealtimeSession).not.toHaveBeenCalled();
  });

  it("throws when the campaign is not found / not owned", async () => {
    mockFetchCampaignById.mockResolvedValue(null);

    await expect(startScreeningPreviewSession(UUID)).rejects.toThrow("Campaign not found");
    expect(mockCreateRealtimeSession).not.toHaveBeenCalled();
  });

  it("mints a session with instructions built from the campaign's questions", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFetchCampaignById.mockResolvedValue({ id: UUID, title: "Senior Backend Engineer" } as any);
    mockFetchQuestions.mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "q1", prompt: "Describe a scaling problem you solved.", is_required: true } as any,
    ]);
    const session = { clientSecret: "ek_x", expiresAt: 1, model: "gpt-realtime" };
    mockCreateRealtimeSession.mockResolvedValue(session);

    await expect(startScreeningPreviewSession(UUID)).resolves.toEqual(session);

    const instructions = mockCreateRealtimeSession.mock.calls[0][0]?.instructions ?? "";
    expect(instructions).toContain("Describe a scaling problem you solved.");
    expect(instructions).toContain("Senior Backend Engineer");
    expect(instructions.toLowerCase()).toContain("follow-up");
  });
});
