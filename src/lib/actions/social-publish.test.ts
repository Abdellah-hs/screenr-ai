import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockFetchSocialConnection,
  mockPublishLinkedInText,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchSocialConnection: vi.fn(),
  mockPublishLinkedInText: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/lib/data/integrations", () => ({
  fetchSocialConnection: mockFetchSocialConnection,
}));

vi.mock("@/lib/services/linkedin", () => ({
  LINKEDIN_PROVIDER: "linkedin",
  publishLinkedInText: mockPublishLinkedInText,
}));

import { publishLinkedInPost } from "./social-publish";

const LIVE_CONNECTION = {
  access_token: "tok-1",
  account_id: "member-9",
  token_expires_at: "2999-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockPublishLinkedInText.mockResolvedValue({ postUrn: "urn:li:share:1" });
});

describe("publishLinkedInPost", () => {
  it("rejects an anonymous caller before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(publishLinkedInPost({ text: "We're hiring!" })).rejects.toThrow("Unauthorized");
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockPublishLinkedInText).not.toHaveBeenCalled();
  });

  it("errors with a connect prompt when LinkedIn isn't connected", async () => {
    mockFetchSocialConnection.mockResolvedValue(null);

    await expect(publishLinkedInPost({ text: "We're hiring!" })).rejects.toThrow(/connect linkedin/i);
    expect(mockPublishLinkedInText).not.toHaveBeenCalled();
  });

  it("errors when the stored token has expired", async () => {
    mockFetchSocialConnection.mockResolvedValue({
      ...LIVE_CONNECTION,
      token_expires_at: "2000-01-01T00:00:00.000Z",
    });

    await expect(publishLinkedInPost({ text: "We're hiring!" })).rejects.toThrow(/expired/i);
    expect(mockPublishLinkedInText).not.toHaveBeenCalled();
  });

  it("publishes with the stored token + member id and returns the post urn", async () => {
    mockFetchSocialConnection.mockResolvedValue(LIVE_CONNECTION);

    const result = await publishLinkedInPost({ text: "We're hiring a Backend Engineer!" });

    expect(mockPublishLinkedInText).toHaveBeenCalledWith({
      accessToken: "tok-1",
      memberId: "member-9",
      text: "We're hiring a Backend Engineer!",
    });
    expect(result).toEqual({ postUrn: "urn:li:share:1" });
  });

  it("rejects an empty post before hitting LinkedIn", async () => {
    mockFetchSocialConnection.mockResolvedValue(LIVE_CONNECTION);

    await expect(publishLinkedInPost({ text: "   " })).rejects.toThrow();
    expect(mockPublishLinkedInText).not.toHaveBeenCalled();
  });
});
