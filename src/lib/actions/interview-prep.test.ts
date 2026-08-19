import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_ID = "550e8400-e29b-41d4-a716-446655440000";

const { mockPeek, mockCreateAdminClient, mockFetchContext } = vi.hoisted(() => ({
  mockPeek: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFetchContext: vi.fn(),
}));

vi.mock("@/lib/auth/screening-token", () => ({ peekResponseToken: mockPeek }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/data/candidates", () => ({
  fetchInterviewContextByApplicationId: mockFetchContext,
}));

import { loadInterviewPrep } from "./interview-prep";

const EXPIRES = new Date("2026-09-01T09:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPeek.mockReturnValue({
    application_id: APP_ID,
    expires_at: EXPIRES,
    expired: false,
  });
  mockCreateAdminClient.mockReturnValue({});
  mockFetchContext.mockResolvedValue({
    application_id: APP_ID,
    campaign_id: "camp-1",
    campaign_title: "Staff Engineer",
    campaign_status: "active",
    candidate_first_name: "Ada",
    candidate_last_name: "Lovelace",
    resume: null,
    interview_persona: "pressure",
  });
});

describe("loadInterviewPrep", () => {
  it("returns the guide for a valid token", async () => {
    const result = await loadInterviewPrep("good.token");

    expect(result.state).toBe("ready");
    if (result.state !== "ready") return;
    expect(result.context.campaignTitle).toBe("Staff Engineer");
    expect(result.context.guide.sections.length).toBeGreaterThan(0);
  });

  it("builds the guide from the campaign's configured persona", async () => {
    const result = await loadInterviewPrep("good.token");

    if (result.state !== "ready") throw new Error("expected ready");
    const text = result.context.guide.sections.flatMap((s) => s.items).join(" ");
    expect(text).toContain("Expect to be challenged");
  });

  /**
   * A lapsed token still authenticates — the signature check is identical — so
   * the page can say "your link expired" instead of the generic failure a
   * throw would produce.
   */
  it("reports an expired link distinctly from a broken one", async () => {
    mockPeek.mockReturnValue({
      application_id: APP_ID,
      expires_at: EXPIRES,
      expired: true,
    });

    const result = await loadInterviewPrep("lapsed.token");

    expect(result.state).toBe("expired");
  });

  /**
   * `peekResponseToken`'s contract: an expired token is never access. The
   * expired branch must not leak the campaign it belonged to.
   */
  it("reads nothing at all for an expired token", async () => {
    mockPeek.mockReturnValue({
      application_id: APP_ID,
      expires_at: EXPIRES,
      expired: true,
    });

    await loadInterviewPrep("lapsed.token");

    expect(mockFetchContext).not.toHaveBeenCalled();
  });

  it("reports a forged or malformed token as invalid", async () => {
    mockPeek.mockImplementation(() => {
      throw new Error("This link is not valid.");
    });

    const result = await loadInterviewPrep("tampered.token");

    expect(result.state).toBe("invalid");
    expect(mockFetchContext).not.toHaveBeenCalled();
  });

  it("handles an application that no longer resolves", async () => {
    mockFetchContext.mockResolvedValue(null);

    const result = await loadInterviewPrep("good.token");

    expect(result.state).toBe("invalid");
  });

  /**
   * Read-only, deliberately. Opening a dead prep link must not close anyone
   * out: a candidate reading the guide has not failed to attend, and the
   * interview page owns the expiry transition.
   */
  it("never transitions anything", async () => {
    mockPeek.mockReturnValue({
      application_id: APP_ID,
      expires_at: EXPIRES,
      expired: true,
    });

    // Nothing to assert against a transition mock, because the module does not
    // import one — this test exists so adding that import fails review.
    const result = await loadInterviewPrep("lapsed.token");

    expect(result).toEqual({ state: "expired" });
  });

  it("uses the admin client, since the candidate has no session", async () => {
    await loadInterviewPrep("good.token");

    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(mockFetchContext).toHaveBeenCalledWith(APP_ID, {});
  });
});
