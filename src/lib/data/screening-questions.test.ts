import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResponseUpdate = vi.fn();
const mockUpdateEq = vi.fn();
const mockResponseSelect = vi.fn();
const mockSelectEq = vi.fn();
const mockSelectMaybeSingle = vi.fn();
const mockAuditInsert = vi.fn();
const mockAppSelect = vi.fn();
const mockAppEq = vi.fn();
const mockAppSingle = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import {
  saveAnswerScores,
  saveVoiceTranscript,
  markScreeningResponseExpired,
  fetchScoringContextByApplicationId,
  type VoiceTranscriptTurn,
} from "./screening-questions";

beforeEach(() => {
  vi.clearAllMocks();

  // Update chain: from(table).update({...}).eq(col, val) → { error }
  mockResponseUpdate.mockReturnValue({ eq: mockUpdateEq });
  mockUpdateEq.mockResolvedValue({ error: null });

  // Select chain (read existing response for merging):
  //   from(table).select("*").eq(col, val).maybeSingle() → { data, error }
  mockSelectMaybeSingle.mockResolvedValue({
    data: {
      answers: [
        { question_id: "q-1", answer_text: "alpha" },
        { question_id: "q-2", answer_text: "beta" },
      ],
    },
    error: null,
  });
  mockSelectEq.mockReturnValue({ maybeSingle: mockSelectMaybeSingle });
  mockResponseSelect.mockReturnValue({ eq: mockSelectEq });

  mockAuditInsert.mockResolvedValue({ error: null });

  // applications join chain: from("applications").select(...).eq("id", id).single()
  mockAppSelect.mockReturnValue({ eq: mockAppEq });
  mockAppEq.mockReturnValue({ single: mockAppSingle });
  mockAppSingle.mockResolvedValue({
    data: {
      candidate_id: "cand-1",
      campaign_id: "camp-1",
      campaigns: {
        user_id: "user-1",
        description: "We need a backend engineer who can scale systems.",
        automation_mode: "human_in_loop",
        screening_threshold: 70,
      },
    },
    error: null,
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "screening_question_responses") {
      return { update: mockResponseUpdate, select: mockResponseSelect };
    }
    if (table === "ai_audit_log") return { insert: mockAuditInsert };
    if (table === "applications") return { select: mockAppSelect };
    throw new Error(`Unexpected supabase.from(${table})`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveAnswerScores", () => {
  const validArgs = {
    applicationId: "app-1",
    campaignId: "camp-1",
    candidateId: "cand-1",
    overall: { score: 72, rationale: "Solid answers with concrete examples." },
    perAnswer: [
      { question_id: "q-1", score: 80, rationale: "Specific" },
      { question_id: "q-2", score: 64, rationale: "Generic" },
    ],
    rubricVersion: 3,
    audit: {
      model: "gpt-4o-mini",
      promptVersion: "v1_screening_scoring",
      rawOutput: '{"overall_score":72,"overall_rationale":"Solid.","answers":[]}',
      inputSnapshot: { question_count: 2, question_ids: ["q-1", "q-2"], answered_count: 2 },
    },
  };

  it("writes both the response update and the audit row on the happy path", async () => {
    await saveAnswerScores(validArgs);

    expect(mockFrom).toHaveBeenCalledWith("screening_question_responses");
    expect(mockFrom).toHaveBeenCalledWith("ai_audit_log");

    expect(mockResponseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "scored",
        overall_score: 72,
        overall_rationale: "Solid answers with concrete examples.",
      }),
    );

    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        candidate_id: "cand-1",
        stage: "screening_scoring",
        model: "gpt-4o-mini",
        prompt_version: "v1_screening_scoring",
        raw_output: validArgs.audit.rawOutput,
        parsed_score: 72,
        rationale: validArgs.overall.rationale,
        action_taken: "scored",
      }),
    );
  });

  it("merges per-answer scores into the existing answers payload before writing", async () => {
    await saveAnswerScores(validArgs);

    const updatePayload = mockResponseUpdate.mock.calls[0][0];
    expect(updatePayload.answers).toEqual([
      { question_id: "q-1", answer_text: "alpha", score: 80, rationale: "Specific" },
      { question_id: "q-2", answer_text: "beta", score: 64, rationale: "Generic" },
    ]);
  });

  it("forwards the input_snapshot verbatim into the audit row", async () => {
    await saveAnswerScores(validArgs);

    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_snapshot: { question_count: 2, question_ids: ["q-1", "q-2"], answered_count: 2 },
      }),
    );
  });

  it("stamps rubric_version on both the response row and the audit row", async () => {
    await saveAnswerScores(validArgs);

    expect(mockResponseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: 3 }),
    );
    // ai_audit_log.rubric_version is TEXT — the integer is coerced to a string label.
    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: "3" }),
    );
  });

  it("writes nulls for rubric_version when the campaign has no active rubric", async () => {
    await saveAnswerScores({ ...validArgs, rubricVersion: null });

    expect(mockResponseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: null }),
    );
    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: null }),
    );
  });

  it("throws and skips the audit write when the response update fails", async () => {
    mockUpdateEq.mockResolvedValueOnce({ error: { message: "RLS denied" } });

    await expect(saveAnswerScores(validArgs)).rejects.toThrow(/Failed to save answer scores: RLS denied/);
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it("throws when the screening response row is missing (and skips the audit write)", async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(saveAnswerScores(validArgs)).rejects.toThrow(/Screening response not found/);
    expect(mockResponseUpdate).not.toHaveBeenCalled();
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it("throws a compliance-gap error when the audit insert fails after a successful score write", async () => {
    mockAuditInsert.mockResolvedValueOnce({ error: { message: "RLS denied on ai_audit_log" } });

    await expect(saveAnswerScores(validArgs)).rejects.toThrow(/Screening scored but audit log write failed/);
    expect(mockResponseUpdate).toHaveBeenCalled();
  });
});

describe("saveVoiceTranscript", () => {
  const transcript: VoiceTranscriptTurn[] = [
    { role: "agent", text: "Tell me about a scaling problem you solved.", at: "2026-06-03T10:00:00.000Z" },
    { role: "candidate", text: "We sharded the orders table by tenant.", at: "2026-06-03T10:00:09.000Z" },
  ];

  it("writes the transcript and flips the row to responded", async () => {
    await saveVoiceTranscript("app-1", transcript);

    expect(mockFrom).toHaveBeenCalledWith("screening_question_responses");
    expect(mockResponseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "responded", transcript }),
    );
    expect(mockUpdateEq).toHaveBeenCalledWith("application_id", "app-1");
  });

  it("stamps responded_at on the row", async () => {
    await saveVoiceTranscript("app-1", transcript);

    const payload = mockResponseUpdate.mock.calls[0][0];
    expect(payload.responded_at).toEqual(expect.any(String));
  });

  it("throws when the update fails", async () => {
    mockUpdateEq.mockResolvedValueOnce({ error: { message: "RLS denied" } });

    await expect(saveVoiceTranscript("app-1", transcript)).rejects.toThrow(
      /Failed to save voice transcript: RLS denied/,
    );
  });
});

describe("fetchScoringContextByApplicationId", () => {
  it("flattens the application + campaign join into a scoring context", async () => {
    const ctx = await fetchScoringContextByApplicationId("app-1");

    expect(mockFrom).toHaveBeenCalledWith("applications");
    expect(mockAppEq).toHaveBeenCalledWith("id", "app-1");
    expect(ctx).toEqual({
      campaign_id: "camp-1",
      candidate_id: "cand-1",
      owner_user_id: "user-1",
      description: "We need a backend engineer who can scale systems.",
      automation_mode: "human_in_loop",
      screening_threshold: 70,
    });
  });

  it("returns null when the application is not found", async () => {
    mockAppSingle.mockResolvedValueOnce({ data: null, error: { message: "no rows" } });

    expect(await fetchScoringContextByApplicationId("missing")).toBeNull();
  });

  it("returns null when the joined campaign has no owner", async () => {
    mockAppSingle.mockResolvedValueOnce({
      data: { candidate_id: "cand-1", campaign_id: "camp-1", campaigns: { user_id: null } },
      error: null,
    });

    expect(await fetchScoringContextByApplicationId("app-1")).toBeNull();
  });
});

describe("markScreeningResponseExpired", () => {
  it("flips the row to expired for the given application", async () => {
    await markScreeningResponseExpired("app-1");

    expect(mockResponseUpdate).toHaveBeenCalledWith({ status: "expired" });
    expect(mockUpdateEq).toHaveBeenCalledWith("application_id", "app-1");
  });

  it("throws when the update fails", async () => {
    mockUpdateEq.mockResolvedValueOnce({ error: { message: "RLS denied" } });

    await expect(markScreeningResponseExpired("app-1")).rejects.toThrow(
      /Failed to expire screening response: RLS denied/,
    );
  });
});
