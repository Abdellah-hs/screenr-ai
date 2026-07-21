import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockCheckRateLimit,
  mockGenerateJobDescription,
  mockGenerateSocialPosts,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGenerateJobDescription: vi.fn(),
  mockGenerateSocialPosts: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/lib/services/openai", () => ({
  generateScreeningCriteria: vi.fn(),
  generateRubricDimensions: vi.fn(),
  generateJobDescription: mockGenerateJobDescription,
  generateSocialPosts: mockGenerateSocialPosts,
}));

import { generateCampaignDescription, generateSocialPosts } from "./ai-generate";

const SAMPLE_POSTS = {
  linkedin: "We're hiring.",
  x: "We're hiring! #jobs",
  facebook: "Join us.",
  general: "Open role. Apply now.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockGenerateJobDescription.mockResolvedValue("A drafted job description.");
  mockGenerateSocialPosts.mockResolvedValue(SAMPLE_POSTS);
});

describe("generateCampaignDescription", () => {
  it("rejects an anonymous caller before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      generateCampaignDescription({ mode: "generate", title: "Backend Engineer" }),
    ).rejects.toThrow("Unauthorized");
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateJobDescription).not.toHaveBeenCalled();
  });

  it("rejects an improve request with no draft before calling the model", async () => {
    await expect(
      generateCampaignDescription({ mode: "improve", title: "Backend Engineer" }),
    ).rejects.toThrow();
    expect(mockGenerateJobDescription).not.toHaveBeenCalled();
  });

  it("delegates validated inputs to the service and returns the draft text", async () => {
    const result = await generateCampaignDescription({
      mode: "generate",
      title: "Backend Engineer",
      seniority: "Senior",
      skills: ["Go", "PostgreSQL"],
    });

    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockGenerateJobDescription).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "generate",
        title: "Backend Engineer",
        seniority: "Senior",
        skills: ["Go", "PostgreSQL"],
      }),
    );
    expect(result).toEqual({ text: "A drafted job description." });
  });
});

describe("generateSocialPosts", () => {
  it("rejects an anonymous caller before doing any work", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      generateSocialPosts({ title: "Backend Engineer", description: "Build APIs." }),
    ).rejects.toThrow("Unauthorized");
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockGenerateSocialPosts).not.toHaveBeenCalled();
  });

  it("rejects a request with no title before calling the model", async () => {
    await expect(
      generateSocialPosts({ title: "", description: "Build APIs." }),
    ).rejects.toThrow();
    expect(mockGenerateSocialPosts).not.toHaveBeenCalled();
  });

  it("delegates validated inputs to the service and returns the posts", async () => {
    const result = await generateSocialPosts({
      title: "Backend Engineer",
      description: "Build APIs.",
      location: "Remote",
      tone: "friendly",
    });

    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockGenerateSocialPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Backend Engineer",
        location: "Remote",
        tone: "friendly",
      }),
    );
    expect(result).toEqual(SAMPLE_POSTS);
  });
});
