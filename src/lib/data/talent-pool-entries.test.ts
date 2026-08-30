import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

import { fetchPooledCandidateEvidence } from "./talent-pool-entries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPooledCandidateEvidence", () => {
  // from("applications").select().in("candidate_id").eq("campaigns.user_id").order()
  const terminal = vi.fn();
  let selected = "";

  beforeEach(() => {
    selected = "";
    mockFrom.mockReturnValue({
      select: (columns: string) => {
        selected = columns;
        return { in: () => ({ eq: () => ({ order: terminal }) }) };
      },
    });
  });

  function appRow(overrides: Record<string, unknown> = {}) {
    return {
      candidate_id: "cand-1",
      campaign_id: "camp-1",
      created_at: "2026-08-01T09:00:00.000Z",
      resume_score: 45,
      parsed_data: null,
      campaigns: { id: "camp-1", title: "Backend Engineer" },
      screening_question_responses: { overall_score: 72, status: "scored" },
      interview_sessions: { scores: { overall_score: 88 } },
      ...overrides,
    };
  }

  it("resolves the screening and interview scores from the rows that hold them", async () => {
    terminal.mockResolvedValue({ data: [appRow()], error: null });

    const [row] = await fetchPooledCandidateEvidence("user-1", ["cand-1"]);

    expect(row).toMatchObject({
      resume_score: 45,
      screening_score: 72,
      interview_score: 88,
    });
  });

  // `applications.screening_q_score` and `applications.interview_score` have
  // never been written, so reading them made `bestScore` the resume score
  // alone — and the pool's score-range filter dropped anyone whose best work
  // came after their CV.
  it("does not read the two application columns nothing writes", async () => {
    terminal.mockResolvedValue({ data: [], error: null });

    await fetchPooledCandidateEvidence("user-1", ["cand-1"]);

    expect(selected).not.toContain("screening_q_score");
    expect(selected).not.toContain("interview_score");
  });

  it("treats an unscored screening response as no screening score", async () => {
    terminal.mockResolvedValue({
      data: [
        appRow({
          screening_question_responses: { overall_score: 72, status: "completed" },
        }),
      ],
      error: null,
    });

    const [row] = await fetchPooledCandidateEvidence("user-1", ["cand-1"]);

    expect(row.screening_score).toBeNull();
  });

  it("survives an application that never reached screening or interview", async () => {
    terminal.mockResolvedValue({
      data: [appRow({ screening_question_responses: null, interview_sessions: null })],
      error: null,
    });

    const [row] = await fetchPooledCandidateEvidence("user-1", ["cand-1"]);

    expect(row).toMatchObject({ screening_score: null, interview_score: null });
  });

  it("short-circuits without querying when nobody is pooled", async () => {
    expect(await fetchPooledCandidateEvidence("user-1", [])).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws on a query error rather than reporting an empty history", async () => {
    terminal.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(fetchPooledCandidateEvidence("user-1", ["cand-1"])).rejects.toThrow(
      /boom/,
    );
  });
});
