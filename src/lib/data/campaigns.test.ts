import { beforeEach, describe, it, expect, vi } from "vitest";

// Supabase chain mock for the query helpers:
//   from("campaigns").select(...).eq("id", …).eq("user_id", …).is("deleted_at", null).single()
const mockSingle = vi.fn();
const mockIs = vi.fn(() => ({ single: mockSingle }));
const mockEqUser = vi.fn(() => ({ is: mockIs }));
const mockEqId = vi.fn(() => ({ eq: mockEqUser }));
const mockSelect = vi.fn(() => ({ eq: mockEqId }));
// Return type is widened so describes below can override the implementation with
// update/insert chains (updateCampaignStatusTx) without a type clash. The table
// name is declared so a describe can dispatch on it (fetchCampaignScoringConfig
// reads three tables in one call).
const mockFrom = vi.fn((table?: string): Record<string, unknown> => {
  void table;
  return { select: mockSelect };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ from: mockFrom })),
}));

import {
  cloneCampaignTx,
  dimensionsEqual,
  fetchCampaignScoringConfig,
  fetchScreeningRubricDimensions,
  fetchCampaignStatus,
  fetchCampaignBySlug,
  insertCampaignTx,
  updateCampaignStatusTx,
  updateCampaignRubricsTx,
  softDeleteCampaignTx,
  restoreCampaignTx,
  mapAvailabilityRows,
} from "./campaigns";
import type { Campaign, DimensionImportance } from "@/lib/constants";
import type { Database } from "@/types/database.types";
import type { SupabaseDb } from "@/lib/supabase/types";

type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];

function campaignPayload(title: string): Omit<CampaignInsert, "user_id"> {
  return { title, description: "A role", status: "draft" } as Omit<CampaignInsert, "user_id">;
}

type AvailabilityRow = {
  id: string;
  campaign_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  created_at: string;
  updated_at: string;
};

function availabilityRow(overrides: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    id: "rule-1",
    campaign_id: "camp-1",
    weekday: 1,
    start_minute: 540,
    end_minute: 1020,
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
    ...overrides,
  };
}

type Intent = {
  name: string;
  importance: DimensionImportance;
  is_mandatory: boolean;
  sort_order: number;
};

function dim(overrides: Partial<Intent> = {}): Intent {
  return {
    name: "React",
    importance: "high",
    is_mandatory: true,
    sort_order: 0,
    ...overrides,
  };
}

describe("dimensionsEqual", () => {
  it("returns true for identical dimension sets", () => {
    const a = [dim(), dim({ name: "Tests", sort_order: 1, is_mandatory: false })];
    const b = [dim(), dim({ name: "Tests", sort_order: 1, is_mandatory: false })];

    expect(dimensionsEqual(a, b)).toBe(true);
  });

  it("ignores array order (compares as sets)", () => {
    const a = [dim({ name: "React", sort_order: 0 }), dim({ name: "Tests", sort_order: 1 })];
    const b = [dim({ name: "Tests", sort_order: 1 }), dim({ name: "React", sort_order: 0 })];

    expect(dimensionsEqual(a, b)).toBe(true);
  });

  it("returns false when importance changed", () => {
    const a = [dim({ importance: "high" })];
    const b = [dim({ importance: "low" })];

    expect(dimensionsEqual(a, b)).toBe(false);
  });

  it("returns false when Must-Have changed", () => {
    const a = [dim({ is_mandatory: true })];
    const b = [dim({ is_mandatory: false })];

    expect(dimensionsEqual(a, b)).toBe(false);
  });

  it("returns false when counts differ", () => {
    const a = [dim()];
    const b = [dim(), dim({ name: "Tests", sort_order: 1 })];

    expect(dimensionsEqual(a, b)).toBe(false);
  });

  it("treats two empty sets as equal", () => {
    expect(dimensionsEqual([], [])).toBe(true);
  });
});

describe("fetchCampaignStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the status scoped to the campaign and owning user", async () => {
    mockSingle.mockResolvedValue({ data: { status: "active" }, error: null });

    const result = await fetchCampaignStatus("camp-1", "user-1");

    expect(result).toBe("active");
    expect(mockFrom).toHaveBeenCalledWith("campaigns");
    expect(mockEqId).toHaveBeenCalledWith("id", "camp-1");
    expect(mockEqUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null when the campaign is missing or not owned", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    expect(await fetchCampaignStatus("camp-1", "user-1")).toBeNull();
  });
});

describe("fetchCampaignBySlug", () => {
  // Self-contained chain: from("campaigns").select(...).eq("public_slug", …)
  //   .is("deleted_at", null).single(). Passed in as `db` so the function never
  //   reaches createAdminClient() — and so this block is order-independent.
  const single = vi.fn();
  const eqIs = { is: vi.fn(() => ({ single })) };
  const eq = vi.fn(() => eqIs);
  const select = vi.fn(() => ({ eq }));
  const db = { from: vi.fn(() => ({ select })) } as unknown as SupabaseDb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the campaign mapped to id/user/title/status + deadline gate fields", async () => {
    single.mockResolvedValue({
      data: {
        id: "camp-1",
        user_id: "user-1",
        title: "Backend Engineer",
        status: "active",
        accepting_applications: false,
        deadline: "2026-07-25T00:00:00.000Z",
        deadline_enforced: true,
      },
      error: null,
    });

    const result = await fetchCampaignBySlug("backend-engineer", db);

    expect(result).toEqual({
      campaign_id: "camp-1",
      user_id: "user-1",
      title: "Backend Engineer",
      status: "active",
      accepting_applications: false,
      deadline: "2026-07-25T00:00:00.000Z",
      deadline_enforced: true,
    });
    expect(eq).toHaveBeenCalledWith("public_slug", "backend-engineer");
  });

  it("defaults intake/deadline fields when the row omits them (legacy rows)", async () => {
    single.mockResolvedValue({
      data: { id: "camp-1", user_id: "user-1", title: "Backend Engineer", status: "active" },
      error: null,
    });

    const result = await fetchCampaignBySlug("backend-engineer", db);

    expect(result).toMatchObject({
      accepting_applications: true,
      deadline: null,
      deadline_enforced: false,
    });
  });

  it("returns null when no campaign owns the slug", async () => {
    single.mockResolvedValue({ data: null, error: { message: "no rows" } });

    expect(await fetchCampaignBySlug("missing", db)).toBeNull();
  });
});

describe("mapAvailabilityRows", () => {
  it("maps rows to the domain shape (weekday + minutes only)", () => {
    const result = mapAvailabilityRows([availabilityRow()]);

    expect(result).toEqual([{ weekday: 1, start_minute: 540, end_minute: 1020 }]);
  });

  it("sorts by weekday, then by start time within a day", () => {
    const result = mapAvailabilityRows([
      availabilityRow({ weekday: 3, start_minute: 600 }),
      availabilityRow({ weekday: 1, start_minute: 780 }),
      availabilityRow({ weekday: 1, start_minute: 540 }),
    ]);

    expect(result.map((r) => [r.weekday, r.start_minute])).toEqual([
      [1, 540],
      [1, 780],
      [3, 600],
    ]);
  });

  it("returns an empty array for undefined or empty input", () => {
    expect(mapAvailabilityRows(undefined)).toEqual([]);
    expect(mapAvailabilityRows([])).toEqual([]);
  });
});

// Kept last: this overrides mockFrom's implementation to expose the update +
// insert chains, so it must not run before the select-based describes above.
describe("updateCampaignStatusTx", () => {
  const updateSingle = vi.fn();
  const auditInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") {
        return { insert: auditInsert };
      }
      // from("campaigns").update().eq().eq().is().select().single()
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ single: updateSingle }),
              }),
            }),
          }),
        }),
      };
    });
  });

  it("updates the status and appends a status-change audit row (old → new)", async () => {
    updateSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await updateCampaignStatusTx("camp-1", "draft", "active", "user-1");

    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        user_id: "user-1",
        action: "campaign_status_changed",
        old_data: { status: "draft" },
        new_data: { status: "active" },
      }),
    );
  });

  it("throws and skips the audit row when no owned row was updated", async () => {
    updateSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    await expect(
      updateCampaignStatusTx("camp-1", "draft", "active", "user-1"),
    ).rejects.toThrow();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});

// Same update + insert chain shape as updateCampaignStatusTx — kept last so the
// mockFrom override doesn't leak into the select-based describes above.
describe("softDeleteCampaignTx", () => {
  const updateSingle = vi.fn();
  const auditInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") {
        return { insert: auditInsert };
      }
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ single: updateSingle }),
              }),
            }),
          }),
        }),
      };
    });
  });

  it("sets deleted_at and appends a campaign_deleted audit row", async () => {
    updateSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await softDeleteCampaignTx("camp-1", "user-1");

    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        user_id: "user-1",
        action: "campaign_deleted",
      }),
    );
  });

  it("throws and skips the audit row when nothing was deleted", async () => {
    updateSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    await expect(softDeleteCampaignTx("camp-1", "user-1")).rejects.toThrow();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});

// Mirrors softDeleteCampaignTx but clears deleted_at, scoped to a currently-
// removed campaign via `.not("deleted_at", "is", null)` (so the chain ends in
// not → select → single). Also an override-based describe, so it stays out of
// the select-based describes above.
describe("restoreCampaignTx", () => {
  const updateSingle = vi.fn();
  const auditInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") {
        return { insert: auditInsert };
      }
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              not: () => ({
                select: () => ({ single: updateSingle }),
              }),
            }),
          }),
        }),
      };
    });
  });

  it("clears deleted_at and appends a campaign_restored audit row", async () => {
    updateSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await restoreCampaignTx("camp-1", "user-1");

    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        user_id: "user-1",
        action: "campaign_restored",
      }),
    );
  });

  it("throws and skips the audit row when nothing was restored", async () => {
    updateSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });

    await expect(restoreCampaignTx("camp-1", "user-1")).rejects.toThrow();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});

// Kept last: overrides mockFrom to expose the campaign insert + audit chains, so
// it must not run before the default-select describes above. Empty rubric / SLA /
// reviewer / availability arrays keep the Tx down to the campaign + audit writes,
// isolating the new slug-derivation + collision-retry logic.
describe("insertCampaignTx", () => {
  const insertSingle = vi.fn();
  // Capture each campaign insert payload so we can assert on the derived slug.
  const insertedPayloads: Record<string, unknown>[] = [];
  const campaignInsert = vi.fn((payload: Record<string, unknown>) => {
    insertedPayloads.push(payload);
    return { select: () => ({ single: insertSingle }) };
  });
  const auditInsert = vi.fn(() => Promise.resolve({ error: null }));
  const questionInsert = vi.fn(() => Promise.resolve({ error: null }));

  beforeEach(() => {
    vi.clearAllMocks();
    insertedPayloads.length = 0;
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") return { insert: auditInsert };
      if (table === "screening_questions") return { insert: questionInsert };
      return { insert: campaignInsert };
    });
  });

  it("derives the public_slug from the title and returns the new id", async () => {
    insertSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    const id = await insertCampaignTx(campaignPayload("Backend Engineer"), [], [], [], [], [], "user-1");

    expect(id).toBe("camp-1");
    expect(insertedPayloads[0]).toMatchObject({
      user_id: "user-1",
      public_slug: "backend-engineer",
    });
  });

  it("retries with a suffixed slug on a unique-violation (23505) collision", async () => {
    insertSingle
      .mockResolvedValueOnce({ data: null, error: { code: "23505" } })
      .mockResolvedValueOnce({ data: { id: "camp-2" }, error: null });

    const id = await insertCampaignTx(campaignPayload("Backend Engineer"), [], [], [], [], [], "user-1");

    expect(id).toBe("camp-2");
    expect(insertedPayloads).toHaveLength(2);
    expect(insertedPayloads[1].public_slug as string).toMatch(/^backend-engineer-[a-z0-9]+$/);
  });

  it("throws without retrying on a non-collision error", async () => {
    insertSingle.mockResolvedValue({ data: null, error: { code: "500", message: "db down" } });

    await expect(
      insertCampaignTx(campaignPayload("Backend Engineer"), [], [], [], [], [], "user-1"),
    ).rejects.toThrow("db down");
    expect(insertedPayloads).toHaveLength(1);
  });

  // Screening questions staged on the create form land in the same Tx as the
  // campaign, so a new campaign is never born unable to approve anyone into
  // screening. sort_order is the array index — the order they are asked in.
  it("writes staged screening questions against the new campaign id", async () => {
    insertSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await insertCampaignTx(
      campaignPayload("Backend Engineer"),
      [],
      [],
      [],
      [],
      [
        { prompt: "Describe a system you scaled past its first design." },
        { prompt: "What made you look outside your current role?" },
      ],
      "user-1",
    );

    expect(questionInsert).toHaveBeenCalledWith([
      {
        campaign_id: "camp-1",
        prompt: "Describe a system you scaled past its first design.",
        sort_order: 0,
      },
      {
        campaign_id: "camp-1",
        prompt: "What made you look outside your current role?",
        sort_order: 1,
      },
    ]);
  });

  it("skips the screening_questions write when none were staged", async () => {
    insertSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });

    await insertCampaignTx(campaignPayload("Backend Engineer"), [], [], [], [], [], "user-1");

    expect(questionInsert).not.toHaveBeenCalled();
  });
});

describe("fetchCampaignScoringConfig", () => {
  // The scoring config is the one place where the resume rule's bar could be
  // wired to the wrong column: both thresholds are integers, so TypeScript is
  // blind to a swap. These tests read the two columns apart.
  type ScoringRow = {
    id: string;
    description: string;
    automation_mode: string;
    resume_threshold: number;
    screening_threshold: number;
  };

  let selectedColumns: string;

  function stubTables(row: ScoringRow | null): void {
    selectedColumns = "";
    mockFrom.mockImplementation((table?: string) => {
      if (table === "campaigns") {
        return {
          select: (columns: string) => {
            selectedColumns = columns;
            return {
              eq: () => ({
                eq: () => ({
                  is: () => ({ single: () => Promise.resolve({ data: row }) }),
                }),
              }),
            };
          },
        };
      }
      if (table === "evaluation_rubrics") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "rub-1" } }) }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({ order: () => Promise.resolve({ data: [] }) }),
          }),
        }),
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps each threshold from its own column", async () => {
    stubTables({
      id: "camp-1",
      description: "Backend engineer",
      automation_mode: "fully_auto",
      resume_threshold: 55,
      screening_threshold: 80,
    });

    const config = await fetchCampaignScoringConfig("camp-1", "user-1");

    expect(config?.resume_threshold).toBe(55);
    expect(config?.screening_threshold).toBe(80);
  });

  it("selects both threshold columns", async () => {
    stubTables({
      id: "camp-1",
      description: "Backend engineer",
      automation_mode: "fully_auto",
      resume_threshold: 55,
      screening_threshold: 80,
    });

    await fetchCampaignScoringConfig("camp-1", "user-1");

    expect(selectedColumns).toContain("resume_threshold");
    expect(selectedColumns).toContain("screening_threshold");
  });

  it("returns null when the campaign is missing or not owned by the caller", async () => {
    stubTables(null);

    expect(await fetchCampaignScoringConfig("camp-1", "user-1")).toBeNull();
  });
});

describe("fetchScreeningRubricDimensions", () => {
  // The bug this fetcher exists to prevent is silent: a resume rubric and a
  // screening rubric are the same shape, so reading the wrong stage returns
  // perfectly valid dimensions and grades a spoken call against the CV's
  // criteria. These tests read the stage filter, not just the return value.
  type DimensionRow = {
    id: string;
    name: string;
    weight: number | null;
    sort_order: number;
  };

  let rubricStage: string | undefined;

  function stubRubric(
    rubric: { id: string; version?: number } | null,
    dimensions: DimensionRow[],
  ): void {
    rubricStage = undefined;
    mockFrom.mockImplementation((table?: string) => {
      if (table === "evaluation_rubrics") {
        return {
          select: () => ({
            eq: () => ({
              eq: (_col: string, value: string) => {
                rubricStage = value;
                return {
                  eq: () => ({ maybeSingle: () => Promise.resolve({ data: rubric }) }),
                };
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () => Promise.resolve({ data: dimensions }),
            }),
          }),
        }),
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the screening rubric, not the resume one", async () => {
    stubRubric({ id: "rub-1" }, []);

    await fetchScreeningRubricDimensions("camp-1");

    expect(rubricStage).toBe("screening_q");
  });

  it("returns each dimension with the weight the recruiter's importance produced", async () => {
    stubRubric({ id: "rub-1" }, [
      { id: "dim-1", name: "Scaling experience", weight: 0.6, sort_order: 0 },
      { id: "dim-2", name: "Debugging method", weight: 0.4, sort_order: 1 },
    ]);

    const { dimensions } = await fetchScreeningRubricDimensions("camp-1");

    expect(dimensions).toEqual([
      { id: "dim-1", name: "Scaling experience", weight: 0.6 },
      { id: "dim-2", name: "Debugging method", weight: 0.4 },
    ]);
  });

  it("carries the rubric version back with the dimensions, off the same row", async () => {
    // The scorer needs both — the dimensions to grade against, the version to
    // stamp the score with — and they live on one `evaluation_rubrics` row.
    // Asking for them separately resolved that row twice per screening score.
    stubRubric({ id: "rub-1", version: 4 }, [
      { id: "dim-1", name: "Scaling experience", weight: 1, sort_order: 0 },
    ]);

    expect((await fetchScreeningRubricDimensions("camp-1")).version).toBe(4);
  });

  it("returns nothing when the campaign has no screening rubric", async () => {
    stubRubric(null, []);

    // Not an empty rubric that scores everyone 0 — "no rubric" is a different
    // fact, and the caller falls back to per-question scoring on it.
    expect(await fetchScreeningRubricDimensions("camp-1")).toEqual({
      dimensions: [],
      version: null,
    });
  });

  it("reads a legacy dimension with no weight as zero rather than undefined", async () => {
    stubRubric({ id: "rub-1" }, [
      { id: "dim-1", name: "Scaling experience", weight: null, sort_order: 0 },
    ]);

    // normalizeWeights turns an all-zero rubric into equal shares; undefined
    // would propagate into the arithmetic as NaN and score everyone 0.
    expect((await fetchScreeningRubricDimensions("camp-1")).dimensions).toEqual([
      { id: "dim-1", name: "Scaling experience", weight: 0 },
    ]);
  });
});

/**
 * A clone is meant to be a campaign you can run. It copied the rubric, the SLA
 * timers and the availability rules but silently dropped the screening
 * questions, which live on their own table — so the copy was born unable to
 * approve anyone into screening, and the recruiter met an "add screening
 * questions" banner on a campaign they had just finished setting up.
 */
describe("cloneCampaignTx", () => {
  const insertSingle = vi.fn();
  const campaignInsert = vi.fn((payload: Record<string, unknown>) => {
    void payload;
    return { select: () => ({ single: insertSingle }) };
  });
  const auditInsert = vi.fn(() => Promise.resolve({ error: null }));
  const questionInsert = vi.fn(() => Promise.resolve({ error: null }));
  const questionOrder = vi.fn();

  function sourceCampaign(): Campaign {
    return {
      id: "camp-source",
      title: "Data scientist",
      description: "Own our forecasting models.",
      department: "Engineering",
      positions: 1,
      status: "active",
      accepting_applications: true,
      deadline: null,
      deadline_enforced: false,
      location: "Casablanca",
      timezone: null,
      public_slug: "data-scientist",
      automation_mode: "human_in_loop",
      resume_threshold: 70,
      screening_threshold: 70,
      interview_persona: "neutral",
      rubrics: [],
      reviewers: [],
      sla_timers: [],
      interview_slot_minutes: 45,
      interview_timezone: null,
      interview_booking_horizon_days: 14,
      interview_availability_rules: [],
      pipeline: [],
      user_id: "user-1",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
      deleted_at: null,
    };
  }

  function questionRow(prompt: string, sortOrder: number) {
    return {
      id: `q-${sortOrder}`,
      campaign_id: "camp-source",
      prompt,
      sort_order: sortOrder,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    insertSingle.mockResolvedValue({ data: { id: "camp-copy" }, error: null });
    questionOrder.mockResolvedValue({ data: [], error: null });
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaign_audit_log") return { insert: auditInsert };
      if (table === "screening_questions") {
        return {
          insert: questionInsert,
          select: () => ({ eq: () => ({ order: questionOrder }) }),
        };
      }
      return { insert: campaignInsert };
    });
  });

  it("copies the source campaign's screening questions, in order", async () => {
    questionOrder.mockResolvedValue({
      data: [
        questionRow("Describe a model you put into production.", 0),
        questionRow("What made you look outside your current role?", 1),
      ],
      error: null,
    });

    await expect(cloneCampaignTx("camp-source", sourceCampaign(), "user-1")).resolves.toBe(
      "camp-copy",
    );

    expect(questionInsert).toHaveBeenCalledWith([
      {
        campaign_id: "camp-copy",
        prompt: "Describe a model you put into production.",
        sort_order: 0,
      },
      {
        campaign_id: "camp-copy",
        prompt: "What made you look outside your current role?",
        sort_order: 1,
      },
    ]);
  });

  it("writes nothing when the source campaign had no questions", async () => {
    await cloneCampaignTx("camp-source", sourceCampaign(), "user-1");

    expect(questionInsert).not.toHaveBeenCalled();
  });

  /**
   * A clone used to be inserted with no `public_slug` at all, which produced a
   * campaign nobody could apply to: there was no apply page, and the card that
   * would have said so rendered nothing for a null slug.
   */
  it("mints its own apply slug rather than inheriting the source's", async () => {
    await cloneCampaignTx("camp-source", sourceCampaign(), "user-1");

    expect(campaignInsert).toHaveBeenCalledWith(
      expect.objectContaining({ public_slug: "data-scientist-copy" }),
    );
    // The source's slug is unique — two campaigns cannot share the one page
    // candidates apply through.
    expect(campaignInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ public_slug: "data-scientist" }),
    );
  });

  it("retries with a suffix when the copy's slug is already taken", async () => {
    // Cloning the same campaign twice collides every time — both copies
    // slugify to "<title>-copy".
    insertSingle
      .mockResolvedValueOnce({ data: null, error: { code: "23505" } })
      .mockResolvedValueOnce({ data: { id: "camp-copy" }, error: null });

    await expect(
      cloneCampaignTx("camp-source", sourceCampaign(), "user-1"),
    ).resolves.toBe("camp-copy");

    expect(campaignInsert).toHaveBeenCalledTimes(2);
    expect(campaignInsert.mock.calls[1][0]).toMatchObject({
      public_slug: expect.stringMatching(/^data-scientist-copy-[a-z0-9]+$/),
    });
  });
});

describe("updateCampaignRubricsTx", () => {
  const ownerSingle = vi.fn();
  const rubricMaybeSingle = vi.fn();
  const dimensionOrder = vi.fn();
  const rubricUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
  const rubricUpdate = vi.fn(() => ({ eq: rubricUpdateEq }));
  const insertedSingle = vi.fn();
  const rubricInsert = vi.fn(() => ({ select: () => ({ single: insertedSingle }) }));
  const dimensionInsert = vi.fn(() => Promise.resolve({ error: null }));
  const auditInsert = vi.fn(() => Promise.resolve({ error: null }));

  function resumeRubric(dimensions: Intent[]) {
    return [{ stage: "resume" as const, dimensions }];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ownerSingle.mockResolvedValue({ data: { id: "camp-1" }, error: null });
    rubricMaybeSingle.mockResolvedValue({ data: null, error: null });
    dimensionOrder.mockResolvedValue({ data: [], error: null });
    insertedSingle.mockResolvedValue({ data: { id: "rub-new" }, error: null });

    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "campaigns") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: ownerSingle }) }) }),
        };
      }
      if (table === "evaluation_rubrics") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: rubricMaybeSingle }) }) }),
          }),
          update: rubricUpdate,
          insert: rubricInsert,
        };
      }
      if (table === "rubric_dimensions") {
        return {
          select: () => ({ eq: () => ({ is: () => ({ order: dimensionOrder }) }) }),
          insert: dimensionInsert,
        };
      }
      return { insert: auditInsert };
    });
  });

  it("refuses a campaign the caller does not own", async () => {
    ownerSingle.mockResolvedValue({ data: null, error: null });

    await expect(
      updateCampaignRubricsTx("camp-1", resumeRubric([dim()]), "user-2"),
    ).rejects.toThrow("Campaign not found or access denied");

    expect(rubricInsert).not.toHaveBeenCalled();
  });

  it("archives the active version and inserts the next one when a dimension changed", async () => {
    rubricMaybeSingle.mockResolvedValue({
      data: { id: "rub-old", version: 3 },
      error: null,
    });
    dimensionOrder.mockResolvedValue({ data: [dim({ name: "React" })], error: null });

    await updateCampaignRubricsTx(
      "camp-1",
      resumeRubric([dim({ name: "Kubernetes" })]),
      "user-1",
    );

    expect(rubricUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
    );
    expect(rubricInsert).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: "camp-1", stage: "resume", version: 4 }),
    );
  });

  it("does not mint a new version when the dimensions are unchanged", async () => {
    rubricMaybeSingle.mockResolvedValue({
      data: { id: "rub-old", version: 3 },
      error: null,
    });
    dimensionOrder.mockResolvedValue({ data: [dim({ name: "React" })], error: null });

    await updateCampaignRubricsTx("camp-1", resumeRubric([dim({ name: "React" })]), "user-1");

    expect(rubricUpdate).not.toHaveBeenCalled();
    expect(rubricInsert).not.toHaveBeenCalled();
  });
});
