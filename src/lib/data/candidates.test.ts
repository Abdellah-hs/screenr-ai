import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCandidatesInsert = vi.fn();
const mockApplicationsUpdate = vi.fn();
const mockApplicationsEq = vi.fn();
const mockApplicationsSelect = vi.fn();
const mockAuditInsert = vi.fn();
const mockFrom = vi.fn();

const mockCreateSignedUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({ createSignedUrl: mockCreateSignedUrl }));

const mockSupabase = { from: mockFrom, storage: { from: mockStorageFrom } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

const mockFindCandidateByEmail = vi.fn();
const mockFindCandidateByPhone = vi.fn();
const mockFlagDuplicateCandidate = vi.fn();

vi.mock("@/lib/data/duplicate-flags", () => ({
  findCandidateByEmail: (...args: unknown[]) => mockFindCandidateByEmail(...args),
  findCandidateByPhone: (...args: unknown[]) => mockFindCandidateByPhone(...args),
  flagDuplicateCandidate: (...args: unknown[]) => mockFlagDuplicateCandidate(...args),
}));

import {
  upsertCandidate,
  saveResumeScore,
  fetchInterviewContextByApplicationId,
  fetchInterviewScoringContext,
} from "./candidates";
import type { ParsedResumeData } from "@/lib/services/openai";

const baseResume: ParsedResumeData & { email: string } = {
  document_type: "cv",
  first_name: "Alice",
  last_name: "Smith",
  headline: null,
  summary: null,
  email: "alice@example.com",
  phone: "+1-555-1111",
  linkedin_url: "",
  github_url: "",
  portfolio_url: "",
  location: "NYC",
  skills: [],
  languages: [],
  interests: [],
  certifications: [],
  experience: [],
  education: [],
};

beforeEach(() => {
  vi.clearAllMocks();

  mockCandidatesInsert.mockResolvedValue({ error: null });
  mockAuditInsert.mockResolvedValue({ error: null });
  mockApplicationsSelect.mockResolvedValue({ data: [{ id: "app-1" }], error: null });
  mockApplicationsEq.mockReturnValue({ select: mockApplicationsSelect });
  mockApplicationsUpdate.mockReturnValue({ eq: mockApplicationsEq });

  // Route by table — saveResumeScore touches both `applications` and
  // `ai_audit_log`, upsertCandidate only touches `candidates`.
  mockFrom.mockImplementation((table: string) => {
    if (table === "candidates") return { insert: mockCandidatesInsert };
    if (table === "applications") return { update: mockApplicationsUpdate };
    if (table === "ai_audit_log") return { insert: mockAuditInsert };
    throw new Error(`Unexpected supabase.from(${table})`);
  });

  mockFindCandidateByEmail.mockResolvedValue(null);
  mockFindCandidateByPhone.mockResolvedValue(null);
  mockFlagDuplicateCandidate.mockResolvedValue("flag-1");

  mockCreateSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://signed.example/resume" },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertCandidate", () => {
  it("inserts a new candidate when no email or phone match exists", async () => {
    const id = await upsertCandidate(baseResume);

    expect(id).toBeTypeOf("string");
    expect(mockFrom).toHaveBeenCalledWith("candidates");
    expect(mockCandidatesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        first_name: "Alice",
      }),
    );
    expect(mockFlagDuplicateCandidate).not.toHaveBeenCalled();
  });

  it("flags a duplicate when an existing candidate has the same email", async () => {
    mockFindCandidateByEmail.mockResolvedValue({ id: "existing-1" });

    const id = await upsertCandidate(baseResume);

    expect(mockFlagDuplicateCandidate).toHaveBeenCalledWith(
      {
        candidateId: id,
        matchedCandidateId: "existing-1",
        matchSignals: expect.objectContaining({
          email_match: true,
          matched_email: "alice@example.com",
        }),
      },
      undefined,
    );
  });

  it("flags a duplicate when only the phone matches (different email)", async () => {
    mockFindCandidateByPhone.mockResolvedValue({ id: "existing-2" });

    const id = await upsertCandidate(baseResume);

    expect(mockFlagDuplicateCandidate).toHaveBeenCalledWith(
      {
        candidateId: id,
        matchedCandidateId: "existing-2",
        matchSignals: expect.objectContaining({
          phone_match: true,
          matched_phone: "+1-555-1111",
        }),
      },
      undefined,
    );
  });

  it("does not look up phone when the resume has no phone", async () => {
    const noPhoneResume: ParsedResumeData & { email: string } = { ...baseResume, phone: "" };

    await upsertCandidate(noPhoneResume);

    expect(mockFindCandidateByPhone).not.toHaveBeenCalled();
    expect(mockFlagDuplicateCandidate).not.toHaveBeenCalled();
  });

  it("propagates insert errors", async () => {
    mockCandidatesInsert.mockResolvedValue({ error: { message: "unique violation" } });

    await expect(upsertCandidate(baseResume)).rejects.toMatchObject({
      message: "unique violation",
    });
  });
});

describe("saveResumeScore", () => {
  const validArgs = {
    applicationId: "app-1",
    campaignId: "camp-1",
    candidateId: "cand-1",
    score: 84,
    tier: "strong" as const,
    rationale: "Strong React + TypeScript fit; led similar systems.",
    factors: [
      { name: "React", weight: 0.6, score: 90 },
      { name: "TypeScript", weight: 0.4, score: 75 },
    ],
    rubricVersion: 2,
    audit: {
      model: "gpt-4o-mini",
      promptVersion: "v1_resume_scoring",
      rawOutput: '{"overall_score":84,"tier":"strong","rationale":"Strong React + TypeScript fit; led similar systems.","factors":[]}',
      inputSnapshot: { criteria_count: 2, criteria_labels: ["React", "TypeScript"] },
    },
  };

  it("writes both the application update and the audit row on the happy path", async () => {
    await saveResumeScore(validArgs);

    expect(mockFrom).toHaveBeenCalledWith("applications");
    expect(mockFrom).toHaveBeenCalledWith("ai_audit_log");

    expect(mockApplicationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        resume_score: 84,
        screening_tier: "strong",
        score_rationale: validArgs.rationale,
      }),
    );

    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        candidate_id: "cand-1",
        stage: "resume_scoring",
        model: "gpt-4o-mini",
        prompt_version: "v1_resume_scoring",
        raw_output: validArgs.audit.rawOutput,
        parsed_score: 84,
        rationale: validArgs.rationale,
        action_taken: "scored",
      }),
    );
  });

  it("forwards the input_snapshot verbatim into the audit row", async () => {
    await saveResumeScore(validArgs);

    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_snapshot: { criteria_count: 2, criteria_labels: ["React", "TypeScript"] },
      }),
    );
  });

  it("stamps rubric_version on both the application row and the audit row", async () => {
    await saveResumeScore(validArgs);

    expect(mockApplicationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: 2 }),
    );
    // ai_audit_log.rubric_version is TEXT — the integer is coerced to a string label.
    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: "2" }),
    );
  });

  it("writes nulls for rubric_version when the campaign has no active rubric", async () => {
    await saveResumeScore({ ...validArgs, rubricVersion: null });

    expect(mockApplicationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: null }),
    );
    expect(mockAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ rubric_version: null }),
    );
  });

  it("throws and skips the audit write when the application update fails", async () => {
    mockApplicationsSelect.mockResolvedValueOnce({ data: null, error: { message: "RLS denied" } });

    await expect(saveResumeScore(validArgs)).rejects.toThrow(/Failed to save resume score: RLS denied/);
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it("throws when the application row is not found (and skips the audit write)", async () => {
    mockApplicationsSelect.mockResolvedValueOnce({ data: [], error: null });

    await expect(saveResumeScore(validArgs)).rejects.toThrow(/application not found or access denied/);
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it("throws a compliance-gap error when the audit insert fails after a successful score write", async () => {
    mockAuditInsert.mockResolvedValueOnce({ error: { message: "RLS denied on ai_audit_log" } });

    await expect(saveResumeScore(validArgs)).rejects.toThrow(/Resume scored but audit log write failed/);
    expect(mockApplicationsUpdate).toHaveBeenCalled();
  });
});

/**
 * The parsed résumé is an APPLICATION column. Selecting it off the `candidates`
 * join makes PostgREST reject the entire query, which surfaced to candidates as
 * "this link is no longer active" on a perfectly valid interview link — so the
 * shape of the select string is part of these functions' contract.
 */
describe("interview context reads", () => {
  const RESUME = { headline: "Data Scientist", summary: null, skills: ["Python", "SQL"] };

  /** Wire `applications.select(...).eq(...).single()` and capture the select string. */
  function stubApplicationsSingle(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result);
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn((query: string) => {
      void query;
      return { eq };
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "applications") return { select };
      throw new Error(`Unexpected supabase.from(${table})`);
    });
    return { select, eq };
  }

  /** The column list the `candidates!inner(...)` join asks for, if any. */
  function candidatesJoinColumns(select: { mock: { calls: [string][] } }): string {
    return /candidates!inner\(([^)]*)\)/.exec(select.mock.calls[0][0])?.[1] ?? "";
  }

  describe("fetchInterviewContextByApplicationId", () => {
    it("reads the parsed résumé off the application, not the candidate", async () => {
      stubApplicationsSingle({
        data: {
          id: "app-1",
          campaign_id: "camp-1",
          parsed_data: RESUME,
          campaigns: { id: "camp-1", title: "Data scientist", status: "active" },
          candidates: { first_name: "Abdellah", last_name: "Hasnaoui" },
        },
        error: null,
      });

      const ctx = await fetchInterviewContextByApplicationId("app-1");

      expect(ctx?.resume).toEqual(RESUME);
      expect(ctx?.campaign_title).toBe("Data scientist");
      expect(ctx?.candidate_first_name).toBe("Abdellah");
    });

    it("never asks the candidates join for parsed_data", async () => {
      const { select } = stubApplicationsSingle({ data: null, error: null });

      await fetchInterviewContextByApplicationId("app-1");

      expect(candidatesJoinColumns(select)).not.toContain("parsed_data");
    });

    it("returns null when the query fails instead of throwing at the candidate", async () => {
      stubApplicationsSingle({ data: null, error: { message: "column does not exist" } });

      await expect(fetchInterviewContextByApplicationId("app-1")).resolves.toBeNull();
    });

    it("reads the campaign's interview persona so the interviewer can be told the stance", async () => {
      stubApplicationsSingle({
        data: {
          id: "app-1",
          campaign_id: "camp-1",
          parsed_data: RESUME,
          campaigns: {
            id: "camp-1",
            title: "Data scientist",
            status: "active",
            interview_persona: "pressure",
          },
          candidates: { first_name: "Abdellah", last_name: "Hasnaoui" },
        },
        error: null,
      });

      const ctx = await fetchInterviewContextByApplicationId("app-1");

      expect(ctx?.interview_persona).toBe("pressure");
    });

    it("falls back to a neutral stance rather than failing the link when none is stored", async () => {
      stubApplicationsSingle({
        data: {
          id: "app-1",
          campaign_id: "camp-1",
          parsed_data: RESUME,
          campaigns: { id: "camp-1", title: "Data scientist", status: "active" },
          candidates: { first_name: "Abdellah", last_name: "Hasnaoui" },
        },
        error: null,
      });

      const ctx = await fetchInterviewContextByApplicationId("app-1");

      expect(ctx?.interview_persona).toBe("neutral");
    });
  });

  describe("fetchInterviewScoringContext", () => {
    it("summarizes the résumé stored on the application", async () => {
      stubApplicationsSingle({
        data: {
          candidate_id: "cand-1",
          campaign_id: "camp-1",
          parsed_data: RESUME,
          campaigns: { user_id: "user-1", description: "Build models" },
        },
        error: null,
      });

      const ctx = await fetchInterviewScoringContext("app-1");

      expect(ctx?.owner_user_id).toBe("user-1");
      expect(ctx?.resume_summary).toContain("Python");
    });

    it("never asks the candidates join for parsed_data", async () => {
      const { select } = stubApplicationsSingle({ data: null, error: null });

      await fetchInterviewScoringContext("app-1");

      expect(candidatesJoinColumns(select)).not.toContain("parsed_data");
    });

    it("carries the persona through so the score records which stance produced the transcript", async () => {
      stubApplicationsSingle({
        data: {
          candidate_id: "cand-1",
          campaign_id: "camp-1",
          parsed_data: RESUME,
          campaigns: {
            user_id: "user-1",
            description: "Build models",
            interview_persona: "socratic",
          },
        },
        error: null,
      });

      const ctx = await fetchInterviewScoringContext("app-1");

      expect(ctx?.interview_persona).toBe("socratic");
    });
  });
});
