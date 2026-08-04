import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProctoringReport } from "@/lib/proctoring/incidents";

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

// Admin (service-role) client — used by the session-less expiry sweep.
const mockAdminFrom = vi.fn();
const mockAdminSelect = vi.fn();
const mockAdminSelectEq = vi.fn();
const mockAdminNot = vi.fn();
const mockAdminLt = vi.fn();
const mockAdminUpdate = vi.fn();
const mockAdminUpdateEq = vi.fn();
const mockAdminSupabase = { from: mockAdminFrom };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}));

import {
  saveAnswerScores,
  saveVoiceTranscript,
  saveVoiceTranscriptDraft,
  saveScreeningProctoringReport,
  markScreeningResponseExpired,
  markScreeningResponseExpiredAsSystem,
  fetchExpiredSentScreeningAppIds,
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

  // Admin client chains for the expiry sweep.
  //   select("application_id").eq("status","sent").not(...).lt(...) → { data, error }
  mockAdminLt.mockResolvedValue({ data: [], error: null });
  mockAdminNot.mockReturnValue({ lt: mockAdminLt });
  mockAdminSelectEq.mockReturnValue({ not: mockAdminNot });
  mockAdminSelect.mockReturnValue({ eq: mockAdminSelectEq });
  //   update({status:"expired"}).eq("application_id", id) → { error }
  mockAdminUpdateEq.mockResolvedValue({ error: null });
  mockAdminUpdate.mockReturnValue({ eq: mockAdminUpdateEq });
  mockAdminFrom.mockReturnValue({
    select: mockAdminSelect,
    update: mockAdminUpdate,
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

describe("saveVoiceTranscriptDraft", () => {
  const transcript: VoiceTranscriptTurn[] = [
    { role: "agent", text: "Tell me about a scaling problem you solved.", at: "2026-06-03T10:00:00.000Z" },
    { role: "candidate", text: "We sharded the orders table by tenant.", at: "2026-06-03T10:00:09.000Z" },
  ];

  // The draft writer takes an explicit db (the agent route passes the admin
  // client) — a purpose-built chain keeps the assertions self-contained.
  function draftDb() {
    const statusEq = vi.fn().mockResolvedValue({ error: null });
    const appEq = vi.fn().mockReturnValue({ eq: statusEq });
    const update = vi.fn().mockReturnValue({ eq: appEq });
    const from = vi.fn().mockReturnValue({ update });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { db: { from } as any, from, update, appEq, statusEq };
  }

  it("writes the transcript WITHOUT touching status or responded_at (draft semantics)", async () => {
    const { db, from, update, appEq } = draftDb();

    await saveVoiceTranscriptDraft("app-1", transcript, db);

    expect(from).toHaveBeenCalledWith("screening_question_responses");
    expect(update).toHaveBeenCalledWith({ transcript });
    expect(appEq).toHaveBeenCalledWith("application_id", "app-1");
  });

  it("only writes while the response is still sent, so a late report can't rewrite a finalized one", async () => {
    const { db, statusEq } = draftDb();

    await saveVoiceTranscriptDraft("app-1", transcript, db);

    expect(statusEq).toHaveBeenCalledWith("status", "sent");
  });

  it("throws when the update fails", async () => {
    const { db, statusEq } = draftDb();
    statusEq.mockResolvedValueOnce({ error: { message: "RLS denied" } });

    await expect(saveVoiceTranscriptDraft("app-1", transcript, db)).rejects.toThrow(
      /Failed to save voice transcript draft: RLS denied/,
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

describe("fetchExpiredSentScreeningAppIds", () => {
  it("queries sent rows past the deadline and returns their application ids", async () => {
    const now = new Date("2026-06-22T12:00:00.000Z");
    mockAdminLt.mockResolvedValueOnce({
      data: [{ application_id: "app-1" }, { application_id: "app-2" }],
      error: null,
    });

    const ids = await fetchExpiredSentScreeningAppIds(now);

    expect(mockAdminFrom).toHaveBeenCalledWith("screening_question_responses");
    expect(mockAdminSelectEq).toHaveBeenCalledWith("status", "sent");
    expect(mockAdminNot).toHaveBeenCalledWith("expires_at", "is", null);
    expect(mockAdminLt).toHaveBeenCalledWith("expires_at", now.toISOString());
    expect(ids).toEqual(["app-1", "app-2"]);
  });

  it("returns an empty array when nothing is overdue", async () => {
    mockAdminLt.mockResolvedValueOnce({ data: [], error: null });

    expect(await fetchExpiredSentScreeningAppIds(new Date())).toEqual([]);
  });

  it("throws when the query fails", async () => {
    mockAdminLt.mockResolvedValueOnce({ error: { message: "boom" } });

    await expect(fetchExpiredSentScreeningAppIds(new Date())).rejects.toThrow(
      /Failed to load expired screening responses: boom/,
    );
  });
});

describe("markScreeningResponseExpiredAsSystem", () => {
  it("flips the row to expired via the admin client", async () => {
    await markScreeningResponseExpiredAsSystem("app-1");

    expect(mockAdminFrom).toHaveBeenCalledWith("screening_question_responses");
    expect(mockAdminUpdate).toHaveBeenCalledWith({ status: "expired" });
    expect(mockAdminUpdateEq).toHaveBeenCalledWith("application_id", "app-1");
  });

  it("throws when the update fails", async () => {
    mockAdminUpdateEq.mockResolvedValueOnce({ error: { message: "denied" } });

    await expect(markScreeningResponseExpiredAsSystem("app-1")).rejects.toThrow(
      /Failed to expire screening response: denied/,
    );
  });
});

describe("saveScreeningProctoringReport", () => {
  const report: ProctoringReport = {
    incidents: [
      {
        type: "tab_blur",
        at: "2026-08-04T10:00:00.000Z",
        duration_ms: 42_000,
        severity: "critical",
        source: "client",
      },
    ],
    summary: {
      tab_blur_count: 1,
      tab_blur_total_ms: 42_000,
      camera_off_count: 0,
      camera_off_total_ms: 0,
      person_absent_count: 0,
      person_absent_total_ms: 0,
      multiple_people_count: 0,
      multiple_people_total_ms: 0,
      phone_visible_count: 0,
      phone_visible_total_ms: 0,
      vision_sampled: false,
      overall_severity: "critical",
    },
    report_version: "proctoring-v3",
    generated_at: "2026-08-04T10:05:00.000Z",
  };

  function proctoringDb() {
    const statusEq = vi.fn().mockResolvedValue({ error: null });
    const appEq = vi.fn().mockReturnValue({ eq: statusEq });
    const update = vi.fn().mockReturnValue({ eq: appEq });
    const from = vi.fn().mockReturnValue({ update });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { db: { from } as any, from, update, appEq, statusEq };
  }

  it("writes the report only while the response is still open", async () => {
    const { db, from, update, appEq, statusEq } = proctoringDb();

    await saveScreeningProctoringReport("app-1", report, db);

    expect(from).toHaveBeenCalledWith("screening_question_responses");
    expect(update).toHaveBeenCalledWith({ proctoring: report });
    expect(appEq).toHaveBeenCalledWith("application_id", "app-1");
    // The guard: a replayed report can't attach evidence to a finished or
    // already-scored screening.
    expect(statusEq).toHaveBeenCalledWith("status", "sent");
  });

  it("throws when the proctoring write fails", async () => {
    const statusEq = vi.fn().mockResolvedValue({ error: { message: "nope" } });
    const from = vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: statusEq }) }),
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      saveScreeningProctoringReport("app-1", report, { from } as any),
    ).rejects.toThrow(/nope/);
  });
});
