import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockVerifyToken,
  mockCheckRateLimit,
  mockHeaders,
  mockFetchInterviewContext,
  mockFetchSession,
  mockEnsureSession,
  mockMarkStarted,
  mockFinalize,
  mockCreateGrant,
  mockTransition,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockHeaders: vi.fn(),
  mockFetchInterviewContext: vi.fn(),
  mockFetchSession: vi.fn(),
  mockEnsureSession: vi.fn(),
  mockMarkStarted: vi.fn(),
  mockFinalize: vi.fn(),
  mockCreateGrant: vi.fn(),
  mockTransition: vi.fn(),
}));

vi.mock("@/lib/auth/screening-token", () => ({
  verifyResponseToken: mockVerifyToken,
  signResponseToken: vi.fn(),
  INTERVIEW_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("next/headers", () => ({ headers: mockHeaders }));
vi.mock("@/lib/data/candidates", () => ({
  fetchInterviewContextByApplicationId: mockFetchInterviewContext,
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  fetchInterviewSessionByApplicationId: mockFetchSession,
  ensureInterviewSession: mockEnsureSession,
  markInterviewStarted: mockMarkStarted,
  finalizeInterviewTranscript: mockFinalize,
}));
vi.mock("@/lib/services/livekit", () => ({ createInterviewRoomGrant: mockCreateGrant }));
vi.mock("@/lib/data/transitions", () => ({ transitionApplication: mockTransition }));

import {
  loadInterviewContext,
  startCandidateInterview,
  submitInterview,
} from "./interview";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

const RESUME_CTX = {
  application_id: "app-1",
  campaign_id: "camp-1",
  campaign_title: "Senior Backend Engineer",
  campaign_status: "active",
  candidate_first_name: "Ada",
  candidate_last_name: "Lovelace",
  resume: {
    first_name: "Ada",
    last_name: "Lovelace",
    headline: "Backend Engineer",
    summary: null,
    skills: ["Go", "Kubernetes"],
    experience: [{ company: "Stripe", title: "Staff Engineer", duration: "2021", description: "Ledger" }],
    education: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyToken.mockReturnValue({ application_id: "app-1", expires_at: FUTURE });
  mockHeaders.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mockFetchInterviewContext.mockResolvedValue(RESUME_CTX);
  mockFetchSession.mockResolvedValue(null);
  mockCreateGrant.mockResolvedValue({
    serverUrl: "wss://x",
    roomName: "interview-app-1-abcd",
    participantToken: "jwt",
  });
});

describe("loadInterviewContext", () => {
  it("returns the campaign framing and session status for the page", async () => {
    mockFetchInterviewContext.mockResolvedValue(RESUME_CTX);
    mockFetchSession.mockResolvedValue({ status: "invited", transcript: [] });

    const ctx = await loadInterviewContext("tok");

    expect(ctx.campaign_title).toBe("Senior Backend Engineer");
    expect(ctx.status).toBe("invited");
  });

  it("reports completed once the interview is done", async () => {
    mockFetchSession.mockResolvedValue({ status: "completed", transcript: [] });

    const ctx = await loadInterviewContext("tok");

    expect(ctx.status).toBe("completed");
  });
});

describe("startCandidateInterview", () => {
  it("blocks when the owning campaign is not active", async () => {
    mockFetchInterviewContext.mockResolvedValue({ ...RESUME_CTX, campaign_status: "paused" });

    await expect(startCandidateInterview("tok")).rejects.toThrow();
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it("opens a room with résumé-grounded, job-titled instructions", async () => {
    const grant = await startCandidateInterview("tok");

    expect(mockEnsureSession).toHaveBeenCalledWith("app-1", FUTURE);
    expect(mockMarkStarted).toHaveBeenCalledWith("app-1");
    const arg = mockCreateGrant.mock.calls[0][0];
    expect(arg.applicationId).toBe("app-1");
    expect(arg.instructions).toContain("Senior Backend Engineer");
    expect(arg.instructions).toContain("Stripe"); // grounded in the real résumé
    expect(grant.roomName).toBe("interview-app-1-abcd");
  });

  it("refuses to reopen a completed interview", async () => {
    mockFetchSession.mockResolvedValue({ status: "completed", transcript: [] });

    await expect(startCandidateInterview("tok")).rejects.toThrow();
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it("rate-limits before doing any work", async () => {
    mockCheckRateLimit.mockImplementationOnce(() => {
      throw new Error("Too many requests");
    });

    await expect(startCandidateInterview("tok")).rejects.toThrow("Too many requests");
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });
});

describe("submitInterview", () => {
  it("rejects a call that captured no candidate speech", async () => {
    mockFetchSession.mockResolvedValue({
      status: "in_progress",
      transcript: [{ role: "agent", text: "Hello?", at: "t" }],
    });

    await expect(submitInterview({ token: "tok" })).rejects.toThrow();
    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("finalizes and advances to interview_completed when the candidate spoke", async () => {
    mockFetchSession.mockResolvedValue({
      status: "in_progress",
      transcript: [
        { role: "agent", text: "Tell me about Stripe", at: "t1" },
        { role: "candidate", text: "I led the ledger rewrite", at: "t2" },
      ],
    });

    const result = await submitInterview({ token: "tok" });

    expect(mockFinalize).toHaveBeenCalledWith("app-1", expect.any(Array));
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app-1", toState: "interview_completed" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("is idempotent once the interview is already completed", async () => {
    mockFetchSession.mockResolvedValue({ status: "completed", transcript: [] });

    const result = await submitInterview({ token: "tok" });

    expect(result).toEqual({ ok: true });
    expect(mockFinalize).not.toHaveBeenCalled();
  });
});
