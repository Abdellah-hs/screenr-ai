import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResponseUpdate = vi.fn();
const mockUpdateEq = vi.fn();
const mockResponseSelect = vi.fn();
const mockSelectEq = vi.fn();
const mockSelectMaybeSingle = vi.fn();
const mockAuditInsert = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import { saveAnswerScores } from "./screening-questions";

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

  mockFrom.mockImplementation((table: string) => {
    if (table === "screening_question_responses") {
      return { update: mockResponseUpdate, select: mockResponseSelect };
    }
    if (table === "ai_audit_log") return { insert: mockAuditInsert };
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
