import { describe, it, expect, vi, beforeEach } from "vitest";

// One configurable `from()` mock; each describe wires the table-specific chain
// it needs onto these terminals.
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

import {
  fetchActiveCampaignsLite,
  fetchPipelineStageCounts,
  fetchExpiringScreeningLinks,
  fetchRecentOutcomes,
  fetchDecisionQueueRows,
} from "./overview";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchActiveCampaignsLite", () => {
  // from("campaigns").select().eq("user_id").eq("status").is("deleted_at", null)
  const terminal = vi.fn();
  beforeEach(() => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ is: terminal }) }) }),
    });
  });

  it("returns the owner's active campaigns", async () => {
    terminal.mockResolvedValue({
      data: [
        { id: "c1", title: "AI Engineer" },
        { id: "c2", title: "Designer" },
      ],
      error: null,
    });

    const result = await fetchActiveCampaignsLite("user-1");

    expect(result).toEqual([
      { id: "c1", title: "AI Engineer" },
      { id: "c2", title: "Designer" },
    ]);
  });

  it("returns [] on a query error rather than throwing", async () => {
    terminal.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await fetchActiveCampaignsLite("user-1")).toEqual([]);
  });
});

describe("fetchPipelineStageCounts", () => {
  // from("applications").select().eq("campaigns.user_id").eq("campaigns.status").is(...)
  const terminal = vi.fn();
  beforeEach(() => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ is: terminal }) }) }),
    });
  });

  it("collapses application states into coarse buckets with a total", async () => {
    terminal.mockResolvedValue({
      data: [
        { status: "new" }, // applied
        { status: "screening_review_pending" }, // applied (resume scored, not approved yet)
        { status: "screening_sent" }, // screening
        { status: "interview_invited" }, // interview
        { status: "manager_review" }, // final_interview
        { status: "hired" }, // hired
        { status: "rejected" }, // rejected
        { status: "screening_expired" }, // rejected (failure folds into rejected)
      ],
      error: null,
    });

    const result = await fetchPipelineStageCounts("user-1");

    expect(result).toMatchObject({
      buckets: {
        applied: 2,
        screening: 1,
        interview: 1,
        final_interview: 1,
        hired: 1,
        rejected: 2,
      },
      total: 8,
    });
  });

  // The rail called the whole `rejected` bucket "Rejected" while the decision
  // queue named the lapsed half of it "nobody was rejected" — one screen, two
  // claims about the same people.
  it("separates people somebody rejected from people who just ran out", async () => {
    terminal.mockResolvedValue({
      data: [
        { status: "rejected" },
        { status: "screening_expired" },
        { status: "interview_no_show" },
        { status: "processing_failed" },
        { status: "archived" },
      ],
      error: null,
    });

    const result = await fetchPipelineStageCounts("user-1");

    expect(result).toMatchObject({ rejectedOutright: 1, closedOut: 4 });
  });

  it("always splits the rejected bucket back into itself", async () => {
    terminal.mockResolvedValue({
      data: [{ status: "rejected" }, { status: "archived" }, { status: "hired" }],
      error: null,
    });

    const { buckets, rejectedOutright, closedOut } = await fetchPipelineStageCounts("u");

    expect(rejectedOutright + closedOut).toBe(buckets.rejected);
  });

  it("returns zeroed buckets on a query error", async () => {
    terminal.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await fetchPipelineStageCounts("user-1");

    expect(result).toEqual({
      buckets: { applied: 0, screening: 0, interview: 0, final_interview: 0, hired: 0, rejected: 0 },
      total: 0,
      rejectedOutright: 0,
      closedOut: 0,
    });
  });
});

describe("fetchDecisionQueueRows", () => {
  // from("applications").select().in("status").eq("campaigns.user_id").is("campaigns.deleted_at")
  const terminal = vi.fn();
  let selected = "";

  beforeEach(() => {
    selected = "";
    mockFrom.mockReturnValue({
      select: (columns: string) => {
        selected = columns;
        return { in: () => ({ eq: () => ({ is: terminal }) }) };
      },
    });
  });

  function queueRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "a1",
      campaign_id: "c1",
      status: "interview_scored",
      updated_at: "2026-08-20T10:00:00.000Z",
      resume_score: 70,
      screening_tier: "eligible",
      candidates: { first_name: "Jane", last_name: "Doe" },
      campaigns: { title: "AI Engineer", status: "active" },
      screening_question_responses: { overall_score: 75, status: "scored" },
      interview_sessions: { scores: { overall_score: 61 } },
      ...overrides,
    };
  }

  it("reads each stage score from the row that actually holds it", async () => {
    terminal.mockResolvedValue({ data: [queueRow()], error: null });

    const [row] = await fetchDecisionQueueRows("user-1");

    expect(row).toMatchObject({
      resumeScore: 70,
      resumeTier: "eligible",
      screeningScore: 75,
      interviewScore: 61,
    });
  });

  // `applications.screening_q_score` and `applications.interview_score` exist
  // in the schema and are written by nothing, so selecting them returned null
  // for every candidate in the group headed "Scored".
  it("does not read the two application columns nothing writes", async () => {
    terminal.mockResolvedValue({ data: [], error: null });

    await fetchDecisionQueueRows("user-1");

    expect(selected).not.toContain("screening_q_score");
    expect(selected).not.toContain("interview_score");
  });

  it("treats an unscored screening response as no screening score", async () => {
    terminal.mockResolvedValue({
      data: [
        queueRow({
          screening_question_responses: { overall_score: 75, status: "completed" },
        }),
      ],
      error: null,
    });

    const [row] = await fetchDecisionQueueRows("user-1");

    expect(row.screeningScore).toBeNull();
  });

  it("survives an application with neither a screening response nor a session", async () => {
    terminal.mockResolvedValue({
      data: [
        queueRow({ screening_question_responses: null, interview_sessions: null }),
      ],
      error: null,
    });

    const [row] = await fetchDecisionQueueRows("user-1");

    expect(row).toMatchObject({ screeningScore: null, interviewScore: null });
  });

  it("returns [] on a query error", async () => {
    terminal.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await fetchDecisionQueueRows("user-1")).toEqual([]);
  });
});

describe("fetchExpiringScreeningLinks", () => {
  // campaigns chain (terminal A) then screening_question_responses chain (terminal B)
  const campaignsTerminal = vi.fn();
  const responsesTerminal = vi.fn();

  beforeEach(() => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "campaigns") {
        return { select: () => ({ eq: () => ({ eq: () => ({ is: campaignsTerminal }) }) }) };
      }
      // screening_question_responses: select().eq().not().gte().lte().in()
      return {
        select: () => ({
          eq: () => ({
            not: () => ({ gte: () => ({ lte: () => ({ in: responsesTerminal }) }) }),
          }),
        }),
      };
    });
  });

  it("groups soon-to-expire sent links per campaign, most urgent first", async () => {
    campaignsTerminal.mockResolvedValue({
      data: [
        { id: "c1", title: "AI Engineer" },
        { id: "c2", title: "Designer" },
      ],
      error: null,
    });
    responsesTerminal.mockResolvedValue({
      data: [
        { applications: { campaign_id: "c1" } },
        { applications: { campaign_id: "c1" } },
        { applications: { campaign_id: "c2" } },
      ],
      error: null,
    });

    const result = await fetchExpiringScreeningLinks("user-1");

    expect(result).toEqual([
      { campaignId: "c1", campaignTitle: "AI Engineer", count: 2 },
      { campaignId: "c2", campaignTitle: "Designer", count: 1 },
    ]);
  });

  it("short-circuits to [] when the owner has no active campaigns", async () => {
    campaignsTerminal.mockResolvedValue({ data: [], error: null });

    expect(await fetchExpiringScreeningLinks("user-1")).toEqual([]);
    expect(responsesTerminal).not.toHaveBeenCalled();
  });
});

describe("fetchRecentOutcomes", () => {
  // from("applications").select().in().eq().is().order().limit()
  const terminal = vi.fn();
  beforeEach(() => {
    mockFrom.mockReturnValue({
      select: () => ({
        in: () => ({ eq: () => ({ is: () => ({ order: () => ({ limit: terminal }) }) }) }),
      }),
    });
  });

  it("maps hired/rejected rows to a named outcome feed", async () => {
    terminal.mockResolvedValue({
      data: [
        {
          status: "hired",
          updated_at: "2026-06-23T10:00:00.000Z",
          campaign_id: "c1",
          candidates: { first_name: "Jane", last_name: "Doe" },
          campaigns: { title: "AI Engineer" },
        },
        {
          status: "rejected",
          updated_at: "2026-06-22T10:00:00.000Z",
          campaign_id: "c2",
          candidates: { first_name: null, last_name: null },
          campaigns: { title: "Designer" },
        },
      ],
      error: null,
    });

    const result = await fetchRecentOutcomes("user-1", 6);

    expect(result).toEqual([
      {
        candidateName: "Jane Doe",
        campaignId: "c1",
        campaignTitle: "AI Engineer",
        outcome: "hired",
        at: "2026-06-23T10:00:00.000Z",
      },
      {
        candidateName: "Unnamed candidate",
        campaignId: "c2",
        campaignTitle: "Designer",
        outcome: "rejected",
        at: "2026-06-22T10:00:00.000Z",
      },
    ]);
  });

  it("returns [] on a query error", async () => {
    terminal.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await fetchRecentOutcomes("user-1")).toEqual([]);
  });
});
