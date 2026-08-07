import { describe, it, expect, vi, beforeEach } from "vitest";

// Captures `after()` callbacks WITHOUT running them, so tests control when
// deferred work (the post-response auto-scoring) executes.
const { afterQueue } = vi.hoisted(() => ({
  afterQueue: [] as Array<() => unknown>,
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterQueue.push(fn);
  },
}));

async function flushAfter(): Promise<void> {
  for (const fn of afterQueue.splice(0)) await fn();
}

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: () => null })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/auth/screening-token", () => ({ verifyResponseToken: vi.fn() }));
vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationForResponse: vi.fn(),
  fetchApplicationCampaignId: vi.fn(),
}));
vi.mock("@/lib/data/screening-questions", () => ({
  fetchScreeningQuestionsByCampaignId: vi.fn(),
  fetchScreeningResponseByApplicationId: vi.fn(),
  fetchScoringContextByApplicationId: vi.fn(),
  saveCandidateAnswers: vi.fn(),
  saveVoiceTranscript: vi.fn(),
  markScreeningResponseExpired: vi.fn(),
  saveScreeningProctoringReport: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __brand: "admin-client" }),
}));
vi.mock("@/lib/data/transitions", () => ({ transitionApplication: vi.fn() }));
// Auto-scoring core is exercised by its own callers' tests; here we only assert
// the voice submit path triggers it. (Also avoids the OpenAI client this module
// instantiates at import.)
vi.mock("./score-screening-response", () => ({ runScreeningScoring: vi.fn() }));
// buildScreeningInstructions stays real (pure); only the LiveKit room/token
// service is stubbed — the network lives there.
vi.mock("@/lib/services/livekit", () => ({ createScreeningRoomGrant: vi.fn() }));

import {
  loadResponseContext,
  startCandidateVoiceScreening,
  submitVoiceScreening,
  reportVoiceScreeningFailure,
} from "./respond";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { fetchApplicationForResponse, type ApplicationForResponse } from "@/lib/data/candidates";
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  fetchScoringContextByApplicationId,
  saveVoiceTranscript,
  saveScreeningProctoringReport,
  markScreeningResponseExpired,
  type ScreeningResponseRow,
  type VoiceTranscriptTurn,
} from "@/lib/data/screening-questions";
import { transitionApplication } from "@/lib/data/transitions";
import { createScreeningRoomGrant } from "@/lib/services/livekit";
import { runScreeningScoring } from "./score-screening-response";

const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockVerifyToken = vi.mocked(verifyResponseToken);
const mockFetchApp = vi.mocked(fetchApplicationForResponse);
const mockFetchQuestions = vi.mocked(fetchScreeningQuestionsByCampaignId);
const mockFetchResponse = vi.mocked(fetchScreeningResponseByApplicationId);
const mockSaveTranscript = vi.mocked(saveVoiceTranscript);
const mockSaveScreeningProctoring = vi.mocked(saveScreeningProctoringReport);
const mockMarkExpired = vi.mocked(markScreeningResponseExpired);
const mockTransition = vi.mocked(transitionApplication);
const mockCreateGrant = vi.mocked(createScreeningRoomGrant);
const mockFetchScoringContext = vi.mocked(fetchScoringContextByApplicationId);
const mockRunScoring = vi.mocked(runScreeningScoring);

const SCORING_CONTEXT = {
  campaign_id: "camp-1",
  candidate_id: "cand-1",
  owner_user_id: "user-1",
  description: "We need a backend engineer who can scale systems.",
  automation_mode: "human_in_loop" as const,
  screening_threshold: 70,
};

const APP_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "tok_abcdefghij";
const GRANT = {
  serverUrl: "wss://demo.livekit.cloud",
  roomName: `screening-${APP_ID}-ab12cd34`,
  participantToken: "jwt-x",
};

function appRow(over: Partial<ApplicationForResponse> = {}): ApplicationForResponse {
  return {
    application_id: APP_ID,
    campaign_id: "camp-1",
    campaign_title: "Senior Backend Engineer",
    campaign_status: "active",
    ...over,
  };
}

function responseRow(over: Partial<ScreeningResponseRow> = {}): ScreeningResponseRow {
  return {
    id: "resp-1",
    application_id: APP_ID,
    status: "sent",
    answers: [],
    transcript: [],
    proctoring: null,
    audio_url: null,
    overall_score: null,
    overall_rationale: null,
    sent_at: "2026-06-03T09:00:00.000Z",
    responded_at: null,
    scored_at: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    ...over,
  };
}

const transcript: VoiceTranscriptTurn[] = [
  { role: "agent", text: "Tell me about a scaling problem you solved.", at: "2026-06-03T10:00:00.000Z" },
  { role: "candidate", text: "We sharded the orders table by tenant.", at: "2026-06-03T10:00:09.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  afterQueue.length = 0;
  mockVerifyToken.mockReturnValue({ application_id: APP_ID, expires_at: new Date("2099-01-01") });
  mockFetchApp.mockResolvedValue(appRow());
  mockFetchResponse.mockResolvedValue(responseRow());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFetchQuestions.mockResolvedValue([{ id: "q1", prompt: "Describe a scaling problem you solved.", is_required: true } as any]);
  mockCreateGrant.mockResolvedValue(GRANT);
  mockTransition.mockResolvedValue(undefined);
  mockFetchScoringContext.mockResolvedValue(SCORING_CONTEXT);
  mockRunScoring.mockResolvedValue({ overall_score: 72 });
});

describe("loadResponseContext", () => {
  it("returns a friendly completed status (not an error) for an already-scored response", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "scored" }));

    const ctx = await loadResponseContext(TOKEN);

    expect(ctx.status).toBe("scored");
    expect(ctx.campaign_title).toBe("Senior Backend Engineer");
  });

  it("returns a completed status for a responded (awaiting-scoring) response", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "responded" }));

    const ctx = await loadResponseContext(TOKEN);

    expect(ctx.status).toBe("responded");
  });

  it("throws for an expired response so the page shows the expired notice", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "expired" }));

    await expect(loadResponseContext(TOKEN)).rejects.toThrow(/expired/i);
  });

  it("returns the questions and any in-progress answers for an open response", async () => {
    mockFetchResponse.mockResolvedValue(
      responseRow({
        status: "sent",
        answers: [
          { question_id: "q1", prompt: "Describe a scaling problem you solved.", answer_text: "draft", score: null, rationale: null },
        ],
      }),
    );

    const ctx = await loadResponseContext(TOKEN);

    expect(ctx.status).toBe("sent");
    expect(ctx.questions).toHaveLength(1);
    expect(ctx.existing_answers).toEqual({ q1: "draft" });
  });

  it("shows the on-hold message for an open response when the campaign isn't Active", async () => {
    mockFetchApp.mockResolvedValue(appRow({ campaign_status: "paused" }));

    await expect(loadResponseContext(TOKEN)).rejects.toThrow(/on hold/i);
  });
});

describe("startCandidateVoiceScreening", () => {
  it("opens a room whose instructions are built from the campaign's questions", async () => {
    await expect(startCandidateVoiceScreening(TOKEN)).resolves.toEqual(GRANT);

    const args = mockCreateGrant.mock.calls[0][0];
    expect(args.applicationId).toBe(APP_ID);
    expect(args.instructions).toContain("Describe a scaling problem you solved.");
    expect(args.instructions).toContain("Senior Backend Engineer");
  });

  it("expires the response and refuses to open a room when the deadline has passed", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ expires_at: "2020-01-01T00:00:00.000Z" }));

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow(/expired/i);
    expect(mockMarkExpired).toHaveBeenCalledWith(APP_ID);
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "screening_expired", actor: "system" }),
    );
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it("refuses to open a room when the campaign has no screening questions", async () => {
    mockFetchQuestions.mockResolvedValue([]);

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow(/no screening questions/i);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it("rate-limits before opening a room", async () => {
    mockCheckRateLimit.mockImplementationOnce(() => {
      throw new Error("Rate limit exceeded");
    });

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow("Rate limit exceeded");
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it("refuses to open a room when the campaign isn't Active (frozen)", async () => {
    mockFetchApp.mockResolvedValue(appRow({ campaign_status: "closed" }));

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow(/on hold/i);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });
});

describe("submitVoiceScreening", () => {
  // The browser sends only the token; the transcript is whatever the agent
  // worker reported server-side — tests stage it on the fetched response row.
  beforeEach(() => {
    mockFetchResponse.mockResolvedValue(responseRow({ transcript }));
  });

  it("promotes the agent-reported draft and advances to screening_completed", async () => {
    await expect(submitVoiceScreening({ token: TOKEN })).resolves.toEqual({ ok: true });

    expect(mockSaveTranscript).toHaveBeenCalledWith(APP_ID, transcript);
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "screening_completed", actor: "system" }),
    );
  });

  // Proctoring for the voice screening: tab focus is the only signal this stage
  // can have (no camera), and it is what catches "hold on, let me look that up".
  it("classifies reported tab-focus events server-side rather than trusting the client", async () => {
    await submitVoiceScreening({
      token: TOKEN,
      proctoringEvents: [
        { type: "tab_blur", at: "2026-06-03T10:00:05.000Z", duration_ms: 42_000 },
      ],
    });

    const [applicationId, report] = mockSaveScreeningProctoring.mock.calls[0];
    expect(applicationId).toBe(APP_ID);
    expect(report.summary.tab_blur_count).toBe(1);
    expect(report.incidents[0].severity).toBe("critical");
    expect(report.incidents[0].source).toBe("client");
  });

  it("drops sub-threshold focus noise so a notification isn't an incident", async () => {
    await submitVoiceScreening({
      token: TOKEN,
      proctoringEvents: [
        { type: "tab_blur", at: "2026-06-03T10:00:05.000Z", duration_ms: 300 },
      ],
    });

    const [, report] = mockSaveScreeningProctoring.mock.calls[0];
    expect(report.incidents).toEqual([]);
    expect(report.summary.overall_severity).toBe("clean");
  });

  it("writes the report before the transcript, so the sent-status guard passes", async () => {
    const order: string[] = [];
    mockSaveScreeningProctoring.mockImplementation(async () => void order.push("proctoring"));
    mockSaveTranscript.mockImplementation(async () => void order.push("transcript"));

    await submitVoiceScreening({ token: TOKEN, proctoringEvents: [] });

    expect(order).toEqual(["proctoring", "transcript"]);
  });

  it("leaves proctoring unwritten when the client reported nothing at all", async () => {
    await submitVoiceScreening({ token: TOKEN });

    expect(mockSaveScreeningProctoring).not.toHaveBeenCalled();
    expect(mockSaveTranscript).toHaveBeenCalled();
  });

  it("still completes the screening when the proctoring write fails", async () => {
    mockSaveScreeningProctoring.mockRejectedValue(new Error("db down"));

    await expect(
      submitVoiceScreening({ token: TOKEN, proctoringEvents: [] }),
    ).resolves.toEqual({ ok: true });
    expect(mockSaveTranscript).toHaveBeenCalled();
  });

  it("discards a malformed report without failing the submit", async () => {
    await expect(
      submitVoiceScreening({
        token: TOKEN,
        proctoringEvents: [{ type: "face_absent", at: "nope", duration_ms: -1 }],
      }),
    ).resolves.toEqual({ ok: true });

    // `face_absent` is a vision type the browser must not be able to claim.
    expect(mockSaveScreeningProctoring).not.toHaveBeenCalled();
    expect(mockSaveTranscript).toHaveBeenCalled();
  });

  it("rejects when no draft transcript was reported, without persisting", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ transcript: [] }));

    await expect(submitVoiceScreening({ token: TOKEN })).rejects.toThrow(/spoken answers/i);
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("rejects a draft with no candidate speech (interviewer-only transcript)", async () => {
    const interviewerOnly: VoiceTranscriptTurn[] = [
      { role: "agent", text: "Tell me about a scaling problem you solved.", at: "2026-06-03T10:00:00.000Z" },
    ];
    mockFetchResponse.mockResolvedValue(responseRow({ transcript: interviewerOnly }));

    await expect(submitVoiceScreening({ token: TOKEN })).rejects.toThrow(/spoken answers/i);
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an already-scored response", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "scored", transcript }));

    await expect(submitVoiceScreening({ token: TOKEN })).rejects.toThrow(
      /already been submitted/i,
    );
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("still succeeds for the candidate when the state transition fails", async () => {
    mockTransition.mockRejectedValue(new Error("Illegal transition"));

    await expect(submitVoiceScreening({ token: TOKEN })).resolves.toEqual({ ok: true });
    expect(mockSaveTranscript).toHaveBeenCalled();
  });

  it("auto-scores the call after the response with the campaign's resolved config (no recruiter click)", async () => {
    await submitVoiceScreening({ token: TOKEN });

    // Scoring is deferred — the candidate's "done" screen never waits on it.
    expect(mockRunScoring).not.toHaveBeenCalled();

    await flushAfter();

    expect(mockRunScoring).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP_ID,
        campaignId: "camp-1",
        candidateId: "cand-1",
        ownerUserId: "user-1",
        automation_mode: "human_in_loop",
        screening_threshold: 70,
      }),
    );
  });

  it("still succeeds for the candidate when auto-scoring throws", async () => {
    mockRunScoring.mockRejectedValue(new Error("OpenAI down"));

    await expect(submitVoiceScreening({ token: TOKEN })).resolves.toEqual({ ok: true });
    await expect(flushAfter()).resolves.toBeUndefined();
    expect(mockSaveTranscript).toHaveBeenCalledWith(APP_ID, transcript);
  });

  it("skips auto-scoring when the campaign has no job description", async () => {
    mockFetchScoringContext.mockResolvedValue({ ...SCORING_CONTEXT, description: null });

    await expect(submitVoiceScreening({ token: TOKEN })).resolves.toEqual({ ok: true });
    await flushAfter();
    expect(mockRunScoring).not.toHaveBeenCalled();
  });

  it("freezes the submission (no save, no score) when the campaign isn't Active", async () => {
    mockFetchApp.mockResolvedValue(appRow({ campaign_status: "paused" }));

    await expect(submitVoiceScreening({ token: TOKEN })).rejects.toThrow(/on hold/i);
    expect(mockSaveTranscript).not.toHaveBeenCalled();
    expect(mockRunScoring).not.toHaveBeenCalled();
  });
});

describe("reportVoiceScreeningFailure", () => {
  it("records completion then processing_failed, in that order", async () => {
    await expect(reportVoiceScreeningFailure({ token: TOKEN })).resolves.toEqual({ ok: true });

    expect(mockTransition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ toState: "screening_completed" }),
    );
    expect(mockTransition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ toState: "processing_failed" }),
    );
  });

  it("does not fail a response that was already scored", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "scored" }));

    await expect(reportVoiceScreeningFailure({ token: TOKEN })).rejects.toThrow(/already been submitted/i);
    expect(mockTransition).not.toHaveBeenCalled();
  });
});
