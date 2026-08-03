import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAdminDb,
  mockVerifyToken,
  mockCheckRateLimit,
  mockHeaders,
  mockFetchInterviewContext,
  mockFetchSession,
  mockEnsureSession,
  mockMarkStarted,
  mockSaveRecording,
  mockSaveProctoring,
  mockFinalize,
  mockCreateGrant,
  mockTransition,
  mockIsRecordingConfigured,
  mockStartRecording,
} = vi.hoisted(() => ({
  // Identity sentinel: candidate-path DB calls must receive THIS client, not the
  // cookie-scoped one (which RLS blanks when there is no recruiter session).
  mockAdminDb: { __brand: "admin-client" },
  mockVerifyToken: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockHeaders: vi.fn(),
  mockFetchInterviewContext: vi.fn(),
  mockFetchSession: vi.fn(),
  mockEnsureSession: vi.fn(),
  mockMarkStarted: vi.fn(),
  mockSaveRecording: vi.fn(),
  mockSaveProctoring: vi.fn(),
  mockFinalize: vi.fn(),
  mockCreateGrant: vi.fn(),
  mockTransition: vi.fn(),
  mockIsRecordingConfigured: vi.fn(),
  mockStartRecording: vi.fn(),
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
  fetchInterviewScoringContext: vi.fn(),
  getInterviewRecordingSignedUrl: vi.fn(),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  fetchInterviewSessionByApplicationId: mockFetchSession,
  ensureInterviewSession: mockEnsureSession,
  markInterviewStarted: mockMarkStarted,
  saveInterviewRecording: mockSaveRecording,
  saveProctoringReport: mockSaveProctoring,
  finalizeInterviewTranscript: mockFinalize,
}));
vi.mock("@/lib/services/livekit", () => ({ createInterviewRoomGrant: mockCreateGrant }));
vi.mock("@/lib/services/livekit-egress", () => ({
  isInterviewRecordingConfigured: mockIsRecordingConfigured,
  startInterviewRecording: mockStartRecording,
}));
vi.mock("@/lib/data/transitions", () => ({
  transitionApplicationAsSystem: mockTransition,
  transitionApplication: vi.fn(() => {
    throw new Error("owner-checked transition must not run on the candidate path");
  }),
}));

// Isolate the auto-score: submitInterview schedules it via after(); mock after
// to a no-op and stub the scoring core so the OpenAI-instantiating module never
// loads into this test's import graph.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./interview-scoring", () => ({ runInterviewScoring: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mockAdminDb }));
// The cookie client must never be reached on the candidate path — it would throw
// outside a request scope anyway, but failing loudly here documents the rule.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    throw new Error("cookie client must not be used on the candidate interview path");
  },
}));

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
  // Recording is off by default; the recording-specific tests opt in.
  mockIsRecordingConfigured.mockReturnValue(false);
  mockStartRecording.mockResolvedValue({ egressId: "EG_1", storageKey: "camp-1/app-1.mp4" });
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

  it("reads through the admin client so a signed link works with no recruiter session", async () => {
    await loadInterviewContext("tok");

    expect(mockFetchInterviewContext).toHaveBeenCalledWith("app-1", mockAdminDb);
    expect(mockFetchSession).toHaveBeenCalledWith("app-1", mockAdminDb);
  });

  it("verifies the token before touching the database", async () => {
    mockVerifyToken.mockImplementationOnce(() => {
      throw new Error("This link is not valid.");
    });

    await expect(loadInterviewContext("forged")).rejects.toThrow("This link is not valid.");
    expect(mockFetchInterviewContext).not.toHaveBeenCalled();
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

    expect(mockEnsureSession).toHaveBeenCalledWith("app-1", FUTURE, mockAdminDb);
    expect(mockMarkStarted).toHaveBeenCalledWith("app-1", mockAdminDb);
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

  it("records the room to storage when recording is configured", async () => {
    mockIsRecordingConfigured.mockReturnValue(true);

    const grant = await startCandidateInterview("tok");

    expect(mockStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: "interview-app-1-abcd",
        campaignId: "camp-1",
        applicationId: "app-1",
      }),
    );
    expect(mockSaveRecording).toHaveBeenCalledWith("app-1", "camp-1/app-1.mp4", mockAdminDb);
    expect(grant.roomName).toBe("interview-app-1-abcd");
  });

  it("still returns the grant when recording fails to start (best-effort)", async () => {
    mockIsRecordingConfigured.mockReturnValue(true);
    mockStartRecording.mockRejectedValueOnce(new Error("egress down"));

    const grant = await startCandidateInterview("tok");

    expect(grant.roomName).toBe("interview-app-1-abcd");
    expect(mockSaveRecording).not.toHaveBeenCalled();
  });

  it("skips recording entirely when it isn't configured", async () => {
    await startCandidateInterview("tok");

    expect(mockStartRecording).not.toHaveBeenCalled();
    expect(mockSaveRecording).not.toHaveBeenCalled();
  });

  it("reads and writes through the admin client (no recruiter session exists)", async () => {
    await startCandidateInterview("tok");

    expect(mockFetchInterviewContext).toHaveBeenCalledWith("app-1", mockAdminDb);
    expect(mockFetchSession).toHaveBeenCalledWith("app-1", mockAdminDb);
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

    expect(mockFinalize).toHaveBeenCalledWith("app-1", expect.any(Array), mockAdminDb);
    expect(mockTransition).toHaveBeenCalledWith(
      "app-1",
      "interview_completed",
      expect.any(String),
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

describe("submitInterview proctoring", () => {
  const SPOKEN = {
    status: "in_progress",
    transcript: [
      { role: "agent", text: "Tell me about Stripe", at: "t1" },
      { role: "candidate", text: "I led the ledger rewrite", at: "t2" },
    ],
  };

  beforeEach(() => {
    mockFetchSession.mockResolvedValue(SPOKEN);
  });

  it("classifies reported events server-side rather than trusting the client", async () => {
    await submitInterview({
      token: "tok",
      proctoringEvents: [
        { type: "tab_blur", at: "2026-07-29T10:00:00.000Z", duration_ms: 45_000 },
      ],
    });

    const [applicationId, report, db] = mockSaveProctoring.mock.calls[0];
    expect(applicationId).toBe("app-1");
    expect(db).toBe(mockAdminDb);
    expect(report.incidents[0].severity).toBe("critical");
    expect(report.summary.overall_severity).toBe("critical");
  });

  it("drops sub-threshold noise before persisting", async () => {
    await submitInterview({
      token: "tok",
      proctoringEvents: [
        { type: "camera_off", at: "2026-07-29T10:00:00.000Z", duration_ms: 900 },
      ],
    });

    const [, report] = mockSaveProctoring.mock.calls[0];
    expect(report.incidents).toEqual([]);
    expect(report.summary.overall_severity).toBe("clean");
  });

  it("records a clean report when the client observed nothing", async () => {
    await submitInterview({ token: "tok", proctoringEvents: [] });

    const [, report] = mockSaveProctoring.mock.calls[0];
    expect(report.summary.overall_severity).toBe("clean");
  });

  it("leaves proctoring unwritten when the client reported nothing at all", async () => {
    await submitInterview({ token: "tok" });

    expect(mockSaveProctoring).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalled();
  });

  it("discards a malformed report without failing the submit", async () => {
    const result = await submitInterview({
      token: "tok",
      proctoringEvents: [{ type: "keylogger", at: "nope", duration_ms: -5 }],
    });

    expect(mockSaveProctoring).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
    expect(mockFinalize).toHaveBeenCalled();
  });

  // Phase C2: the worker's camera readings are stored on the session during the
  // call, so they are folded in at submit regardless of what the browser sends.
  it("folds the worker's vision samples into the report", async () => {
    mockFetchSession.mockResolvedValue({
      ...SPOKEN,
      proctoring_observations: [
        { at: "2026-07-29T10:00:00.000Z", face_count: 2, confidence: 0.9 },
        { at: "2026-07-29T10:00:10.000Z", face_count: 2, confidence: 0.9 },
        { at: "2026-07-29T10:00:20.000Z", face_count: 2, confidence: 0.9 },
      ],
    });

    await submitInterview({ token: "tok", proctoringEvents: [] });

    const [, report] = mockSaveProctoring.mock.calls[0];
    expect(report.summary.multiple_faces_count).toBe(1);
    expect(report.summary.vision_sampled).toBe(true);
    expect(report.incidents[0].source).toBe("vision");
  });

  // The browser payload is the half a candidate controls. Letting junk there
  // discard the worker's evidence would hand them a one-line way to erase it.
  it("keeps vision evidence even when the browser sends a malformed report", async () => {
    mockFetchSession.mockResolvedValue({
      ...SPOKEN,
      proctoring_observations: [
        { at: "2026-07-29T10:00:00.000Z", face_count: 0, confidence: 0.9 },
        { at: "2026-07-29T10:00:10.000Z", face_count: 0, confidence: 0.9 },
        { at: "2026-07-29T10:00:20.000Z", face_count: 0, confidence: 0.9 },
      ],
    });

    await submitInterview({
      token: "tok",
      proctoringEvents: [{ type: "keylogger", at: "nope", duration_ms: -5 }],
    });

    expect(mockSaveProctoring).toHaveBeenCalled();
    const [, report] = mockSaveProctoring.mock.calls[0];
    expect(report.summary.face_absent_count).toBe(1);
    expect(report.summary.tab_blur_count).toBe(0);
  });

  it("writes nothing when neither the browser nor the worker reported anything", async () => {
    mockFetchSession.mockResolvedValue({ ...SPOKEN, proctoring_observations: [] });

    await submitInterview({ token: "tok" });

    expect(mockSaveProctoring).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalled();
  });

  it("still completes the interview when the proctoring write fails", async () => {
    mockSaveProctoring.mockRejectedValue(new Error("db down"));

    const result = await submitInterview({ token: "tok", proctoringEvents: [] });

    expect(result).toEqual({ ok: true });
    expect(mockFinalize).toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledWith(
      "app-1",
      "interview_completed",
      expect.any(String),
    );
  });

  it("writes the report before the session is finalized so the open-status guard passes", async () => {
    const order: string[] = [];
    mockSaveProctoring.mockImplementation(async () => void order.push("proctoring"));
    mockFinalize.mockImplementation(async () => void order.push("finalize"));

    await submitInterview({ token: "tok", proctoringEvents: [] });

    expect(order).toEqual(["proctoring", "finalize"]);
  });
});
