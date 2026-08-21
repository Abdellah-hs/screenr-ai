import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: () => null })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/auth/screening-token", () => ({ signResponseToken: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/services/email-templates/screening-questions", () => ({
  buildScreeningQuestionsEmail: vi.fn(),
}));
// The voice scorer now lives in its own module and builds an OpenAI client at
// import time, so it has to be mocked even by tests that never score a voice
// response — otherwise importing the action under test throws on a missing key.
vi.mock("@/lib/services/screening-evidence", () => ({
  extractTranscriptEvidence: vi.fn(),
  buildCandidateSpeech: vi.fn(() => ""),
}));
vi.mock("@/lib/services/screening-questions", () => ({
  generateQuestionsForRole: vi.fn(),
  scoreAnswers: vi.fn(),
}));
vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignScoringConfig: vi.fn(),
  fetchActiveRubricVersion: vi.fn(),
  verifyCampaignOwnership: vi.fn(),
}));
vi.mock("@/lib/data/transitions", () => ({ transitionApplication: vi.fn() }));
vi.mock("./transition-notifications", () => ({ sendTransitionNotification: vi.fn() }));
vi.mock("@/lib/data/screening-questions", () => ({
  fetchScreeningQuestionsByCampaignId: vi.fn(),
  replaceScreeningQuestions: vi.fn(),
  upsertPendingScreeningResponse: vi.fn(),
  fetchApplicationForScreeningSend: vi.fn(),
  fetchApplicationsReadyForScreeningSend: vi.fn(),
  fetchScreeningResponseByApplicationId: vi.fn(),
  saveAnswerScores: vi.fn(),
}));
// Freeze guard — no-op (active) by default so existing tests are unaffected.
vi.mock("./campaign-guards", () => ({ assertCampaignActiveById: vi.fn() }));

import { saveScreeningQuestions, scoreScreeningAnswers } from "./screening-questions";
import { assertCampaignActiveById } from "./campaign-guards";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import { verifyCampaignOwnership } from "@/lib/data/campaigns";
import { replaceScreeningQuestions } from "@/lib/data/screening-questions";
import { scoreAnswers } from "@/lib/services/screening-questions";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import { transitionApplication } from "@/lib/data/transitions";
import {
  fetchApplicationForScreeningSend,
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  saveAnswerScores,
  type ScreeningQuestionRow,
  type ScreeningResponseRow,
  type VoiceTranscriptTurn,
} from "@/lib/data/screening-questions";
import type { AnswerScoringEvidence } from "@/lib/services/screening-questions";
import {
  buildCandidateSpeech,
  extractTranscriptEvidence,
} from "@/lib/services/screening-evidence";

const mockRequireUserId = vi.mocked(requireUserId);
const mockFetchApp = vi.mocked(fetchApplicationForScreeningSend);
const mockFetchQuestions = vi.mocked(fetchScreeningQuestionsByCampaignId);
const mockFetchResponse = vi.mocked(fetchScreeningResponseByApplicationId);
const mockFetchConfig = vi.mocked(fetchCampaignScoringConfig);
const mockFetchRubricVersion = vi.mocked(fetchActiveRubricVersion);
const mockScoreAnswers = vi.mocked(scoreAnswers);
const mockExtractEvidence = vi.mocked(extractTranscriptEvidence);
const mockCandidateSpeech = vi.mocked(buildCandidateSpeech);
const mockSaveScores = vi.mocked(saveAnswerScores);
const mockTransition = vi.mocked(transitionApplication);
const mockAssertActive = vi.mocked(assertCampaignActiveById);

const APP_ID = "11111111-1111-4111-8111-111111111111";

const question: ScreeningQuestionRow = {
  id: "q1",
  campaign_id: "camp-1",
  prompt: "Describe a scaling problem you solved.",
  is_required: true,
  sort_order: 0,
  created_at: "2026-06-03T09:00:00.000Z",
  updated_at: "2026-06-03T09:00:00.000Z",
};

const transcript: VoiceTranscriptTurn[] = [
  { role: "agent", text: "Describe a scaling problem you solved.", at: "2026-06-03T10:00:00.000Z" },
  { role: "candidate", text: "We sharded the orders table by tenant.", at: "2026-06-03T10:00:06.000Z" },
];

function responseRow(over: Partial<ScreeningResponseRow> = {}): ScreeningResponseRow {
  return {
    id: "resp-1",
    application_id: APP_ID,
    status: "responded",
    answers: [{ question_id: "q1", prompt: question.prompt, answer_text: "", score: null, rationale: null }],
    transcript: [],
    proctoring: null,
    audio_url: null,
    overall_score: null,
    overall_rationale: null,
    sent_at: "2026-06-03T09:00:00.000Z",
    responded_at: "2026-06-03T10:05:00.000Z",
    scored_at: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    ...over,
  };
}

const evidence: AnswerScoringEvidence = {
  result: {
    overall_score: 72,
    overall_rationale: "Concrete scaling example.",
    answers: [{ question_id: "q1", score: 72, rationale: "Sharding by tenant — specific." }],
  },
  rawOutput: '{"overall_score":72}',
  model: "gpt-4o-mini",
  promptVersion: "v1_voice_screening_scoring",
};

/**
 * The voice model returns a LEVEL and a verbatim quote — never a number. The
 * 80 that reaches the decision rule below is derived from "strong" by
 * `src/lib/screening-scoring/`, which is the whole point of the change.
 */
const transcriptEvidence = {
  evidence: {
    answers: [
      {
        question_id: "q1",
        evidence_level: "strong" as const,
        evidence_items: [
          {
            quote: "We sharded the orders table by tenant",
            turn_index: 1,
            explanation: "A concrete scaling change the candidate made.",
          },
        ],
        notes: "Sharding by tenant — specific.",
      },
    ],
    extraction_summary: "Concrete scaling example.",
  },
  rawOutput: '{"answers":[{"evidence_level":"strong"}]}',
  model: "gpt-4o-mini",
  promptVersion: "v3_screening_evidence",
  skipped: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchApp.mockResolvedValue({
    application_id: APP_ID,
    campaign_id: "camp-1",
    candidate_id: "cand-1",
    status: "screening_sent",
    campaign_title: "Senior Backend Engineer",
    candidate_name: "Jane Doe",
    candidate_email: "jane@example.com",
  });
  mockFetchQuestions.mockResolvedValue([question]);
  mockFetchConfig.mockResolvedValue({
    id: "camp-1",
    description: "We need a backend engineer who can scale systems.",
    automation_mode: "human_in_loop",
    // Deliberately different from screening_threshold: this path must read the
    // screening bar, never the CV one.
    resume_threshold: 95,
    screening_threshold: 70,
    screening_criteria: [],
  });
  mockFetchRubricVersion.mockResolvedValue(3);
  mockScoreAnswers.mockResolvedValue({ ...evidence, promptVersion: "v1_screening_scoring" });
  mockExtractEvidence.mockResolvedValue(transcriptEvidence);
  // The real one is pure; the action passes its output to quote verification.
  mockCandidateSpeech.mockReturnValue("We sharded the orders table by tenant.");
  mockSaveScores.mockResolvedValue(undefined);
  mockTransition.mockResolvedValue(undefined);
});

describe("scoreScreeningAnswers — voice transcript", () => {
  beforeEach(() => {
    mockFetchResponse.mockResolvedValue(responseRow({ transcript }));
  });

  it("reads the transcript (not typed answers) when a transcript is present", async () => {
    await scoreScreeningAnswers(APP_ID);

    expect(mockExtractEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ transcript }),
    );
    expect(mockScoreAnswers).not.toHaveBeenCalled();
  });

  /**
   * The change this suite exists to protect: nothing the model returns is a
   * number. "strong" is worth 80 because the deterministic table says so, and
   * that is the figure the decision rule and the stored score both see.
   */
  it("derives the score from the evidence level, not from the model", async () => {
    await scoreScreeningAnswers(APP_ID);

    const saved = mockSaveScores.mock.calls[0][0];
    expect(saved.overall.score).toBe(80);
    expect(saved.perAnswer[0].score).toBe(80);
  });

  it("stores the verified quote so the score traces back to the transcript", async () => {
    await scoreScreeningAnswers(APP_ID);

    const saved = mockSaveScores.mock.calls[0][0];
    expect(saved.perAnswer[0].evidence_quote).toBe("We sharded the orders table by tenant");
    expect(saved.perAnswer[0].evidence_turn_index).toBe(1);
  });

  it("records which scoring rules produced the number", async () => {
    await scoreScreeningAnswers(APP_ID);

    const snapshot = mockSaveScores.mock.calls[0][0].audit.inputSnapshot as Record<string, unknown>;
    expect(snapshot.scoring_rules_version).toBe("v1_evidence_levels");
    expect(snapshot.validation_warnings).toEqual([]);
  });

  it("drops an unverifiable quote and scores the question as no evidence", async () => {
    mockCandidateSpeech.mockReturnValue("Something else entirely.");

    await scoreScreeningAnswers(APP_ID);

    const saved = mockSaveScores.mock.calls[0][0];
    expect(saved.perAnswer[0].score).toBe(0);
    expect(saved.perAnswer[0].evidence_quote).toBeUndefined();
    // Two distinct facts are recorded, not one: the quote failed verification,
    // and the level it was supporting was therefore downgraded.
    const warnings = (saved.audit.inputSnapshot as Record<string, unknown>)
      .validation_warnings as string[];
    expect(warnings.some((w) => /could not be found/.test(w))).toBe(true);
    expect(warnings.some((w) => /downgraded/.test(w))).toBe(true);
  });

  it("persists the scripted-cadence signal as voice-modality audit evidence", async () => {
    await scoreScreeningAnswers(APP_ID);

    const saved = mockSaveScores.mock.calls[0][0];
    const snapshot = saved.audit.inputSnapshot as Record<string, unknown>;
    expect(snapshot.modality).toBe("voice");
    expect(snapshot.cadence_signal).toEqual(
      expect.objectContaining({ scripted_signal: expect.any(String) }),
    );
  });

  it("records screening_scored via the unchanged decision rule", async () => {
    await scoreScreeningAnswers(APP_ID);

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toState: "screening_scored", actor: "system" }),
    );
  });
});

describe("scoreScreeningAnswers — legacy text answers", () => {
  it("scores typed answers when there is no transcript", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ transcript: [] }));

    await scoreScreeningAnswers(APP_ID);

    expect(mockScoreAnswers).toHaveBeenCalled();
    expect(mockExtractEvidence).not.toHaveBeenCalled();
    const saved = mockSaveScores.mock.calls[0][0];
    expect((saved.audit.inputSnapshot as Record<string, unknown>).modality).toBe("text");
  });
});

describe("scoreScreeningAnswers — guards", () => {
  it("refuses to score before the candidate has responded", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "sent" }));

    await expect(scoreScreeningAnswers(APP_ID)).rejects.toThrow(/hasn't submitted/i);
    expect(mockExtractEvidence).not.toHaveBeenCalled();
    expect(mockScoreAnswers).not.toHaveBeenCalled();
  });

  it("refuses to re-score an already-scored response", async () => {
    mockFetchResponse.mockResolvedValue(responseRow({ status: "scored" }));

    await expect(scoreScreeningAnswers(APP_ID)).rejects.toThrow(/already been scored/i);
  });

  it("refuses to score when the campaign isn't Active (frozen)", async () => {
    mockAssertActive.mockRejectedValueOnce(
      new Error("This campaign is paused. Set it to Active to sync resumes, score candidates, or send screening."),
    );

    await expect(scoreScreeningAnswers(APP_ID)).rejects.toThrow(/paused/i);
    expect(mockExtractEvidence).not.toHaveBeenCalled();
    expect(mockScoreAnswers).not.toHaveBeenCalled();
  });
});

describe("saveScreeningQuestions", () => {
  const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";

  it("replaces the set and revalidates the campaign subtree, candidate pages included", async () => {
    vi.mocked(verifyCampaignOwnership).mockResolvedValue(true);
    vi.mocked(replaceScreeningQuestions).mockResolvedValue([]);

    await saveScreeningQuestions(CAMPAIGN_ID, [
      { prompt: "Describe a scaling problem you solved recently.", is_required: true },
    ]);

    expect(vi.mocked(replaceScreeningQuestions)).toHaveBeenCalledWith(CAMPAIGN_ID, [
      { prompt: "Describe a scaling problem you solved recently.", is_required: true },
    ]);
    // "layout" is the regression under test: candidate detail pages under the
    // campaign render the question set (screening thread, HITL approve gate)
    // and must not keep serving a cached "no questions configured" state.
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/campaigns/${CAMPAIGN_ID}`,
      "layout",
    );
  });
});
