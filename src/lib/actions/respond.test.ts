import { describe, it, expect, vi, beforeEach } from "vitest";

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
  saveCandidateAnswers: vi.fn(),
  saveVoiceTranscript: vi.fn(),
  markScreeningResponseExpired: vi.fn(),
}));
vi.mock("@/lib/data/transitions", () => ({ transitionApplication: vi.fn() }));
// Partial mock: keep the real buildScreeningInstructions, stub the network call.
vi.mock("@/lib/services/realtime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/services/realtime")>()),
  createRealtimeSession: vi.fn(),
}));

import {
  startCandidateVoiceScreening,
  submitVoiceScreening,
  reportVoiceScreeningFailure,
} from "./respond";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { fetchApplicationForResponse } from "@/lib/data/candidates";
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  saveVoiceTranscript,
  markScreeningResponseExpired,
  type ScreeningResponseRow,
  type VoiceTranscriptTurn,
} from "@/lib/data/screening-questions";
import { transitionApplication } from "@/lib/data/transitions";
import { createRealtimeSession } from "@/lib/services/realtime";

const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockVerifyToken = vi.mocked(verifyResponseToken);
const mockFetchApp = vi.mocked(fetchApplicationForResponse);
const mockFetchQuestions = vi.mocked(fetchScreeningQuestionsByCampaignId);
const mockFetchResponse = vi.mocked(fetchScreeningResponseByApplicationId);
const mockSaveTranscript = vi.mocked(saveVoiceTranscript);
const mockMarkExpired = vi.mocked(markScreeningResponseExpired);
const mockTransition = vi.mocked(transitionApplication);
const mockCreateSession = vi.mocked(createRealtimeSession);

const APP_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "tok_abcdefghij";
const SESSION = { clientSecret: "ek_x", expiresAt: 1, model: "gpt-realtime" };

function responseRow(over: Partial<ScreeningResponseRow> = {}): ScreeningResponseRow {
  return {
    id: "resp-1",
    application_id: APP_ID,
    status: "sent",
    answers: [],
    transcript: [],
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
  mockVerifyToken.mockReturnValue({ application_id: APP_ID, expires_at: new Date("2099-01-01") });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFetchApp.mockResolvedValue({ campaign_id: "camp-1", campaign_title: "Senior Backend Engineer" } as any);
  mockFetchResponse.mockResolvedValue(responseRow());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFetchQuestions.mockResolvedValue([{ id: "q1", prompt: "Describe a scaling problem you solved.", is_required: true } as any]);
  mockCreateSession.mockResolvedValue(SESSION);
  mockTransition.mockResolvedValue(undefined);
});

describe("startCandidateVoiceScreening", () => {
  it("mints a session whose instructions are built from the campaign's questions", async () => {
    await expect(startCandidateVoiceScreening(TOKEN)).resolves.toEqual(SESSION);

    const instructions = mockCreateSession.mock.calls[0][0]?.instructions ?? "";
    expect(instructions).toContain("Describe a scaling problem you solved.");
    expect(instructions).toContain("Senior Backend Engineer");
  });

  it("expires the response and refuses to mint when the deadline has passed", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ expires_at: "2020-01-01T00:00:00.000Z" }));

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow(/expired/i);
    expect(mockMarkExpired).toHaveBeenCalledWith(APP_ID);
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "screening_expired", actor: "system" }),
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("refuses to mint when the campaign has no screening questions", async () => {
    mockFetchQuestions.mockResolvedValue([]);

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow(/no screening questions/i);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("rate-limits before minting a session", async () => {
    mockCheckRateLimit.mockImplementationOnce(() => {
      throw new Error("Rate limit exceeded");
    });

    await expect(startCandidateVoiceScreening(TOKEN)).rejects.toThrow("Rate limit exceeded");
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

describe("submitVoiceScreening", () => {
  it("persists the transcript and advances to screening_completed", async () => {
    await expect(submitVoiceScreening({ token: TOKEN, transcript })).resolves.toEqual({ ok: true });

    expect(mockSaveTranscript).toHaveBeenCalledWith(APP_ID, transcript);
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "screening_completed", actor: "system" }),
    );
  });

  it("rejects an empty transcript without persisting", async () => {
    await expect(submitVoiceScreening({ token: TOKEN, transcript: [] })).rejects.toThrow(
      /No transcript was captured/i,
    );
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an already-scored response", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "scored" }));

    await expect(submitVoiceScreening({ token: TOKEN, transcript })).rejects.toThrow(
      /already been submitted/i,
    );
    expect(mockSaveTranscript).not.toHaveBeenCalled();
  });

  it("still succeeds for the candidate when the state transition fails", async () => {
    mockTransition.mockRejectedValue(new Error("Illegal transition"));

    await expect(submitVoiceScreening({ token: TOKEN, transcript })).resolves.toEqual({ ok: true });
    expect(mockSaveTranscript).toHaveBeenCalled();
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
