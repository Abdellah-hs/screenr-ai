import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A chainable Supabase stub that records every filter applied. `range()` is the
 * terminal call for the audit query, so it resolves the result.
 */
type QueryResult = { data: unknown; error: unknown; count?: number };

function makeQuery(result: QueryResult) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain = {
    calls,
    select: vi.fn((...args: unknown[]) => (calls.push({ method: "select", args }), chain)),
    eq: vi.fn((...args: unknown[]) => (calls.push({ method: "eq", args }), chain)),
    is: vi.fn((...args: unknown[]) => (calls.push({ method: "is", args }), chain)),
    in: vi.fn((...args: unknown[]) => (calls.push({ method: "in", args }), chain)),
    gte: vi.fn((...args: unknown[]) => (calls.push({ method: "gte", args }), chain)),
    lt: vi.fn((...args: unknown[]) => (calls.push({ method: "lt", args }), chain)),
    order: vi.fn((...args: unknown[]) => (calls.push({ method: "order", args }), chain)),
    range: vi.fn((...args: unknown[]) => {
      calls.push({ method: "range", args });
      return Promise.resolve(result);
    }),
    // Awaiting the chain without range() (the applications/transitions reads).
    then: (resolve: (r: QueryResult) => void) => resolve(result),
  };
  return chain;
}

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: mockFrom })),
}));

import { fetchAuditLog } from "./audit-log";

const AUDIT_ROW = {
  id: "aud-1",
  created_at: "2026-08-18T10:00:00.000Z",
  stage: "resume_scoring",
  model: "gpt-4o-mini",
  prompt_version: "v1",
  rubric_version: "3",
  parsed_score: 82,
  confidence: 0.9,
  rationale: "Strong.",
  raw_output: "{}",
  input_snapshot: {},
  action_taken: null,
  campaign_id: "camp-1",
  candidate_id: "cand-1",
  campaigns: { title: "Backend Engineer" },
  candidates: { first_name: "Ada", last_name: "Lovelace" },
};

/** Wire the three tables the fetch touches, in the order it touches them. */
function wireTables(opts: {
  audit: QueryResult;
  applications?: QueryResult;
  transitions?: QueryResult;
}) {
  const auditQ = makeQuery(opts.audit);
  const appsQ = makeQuery(opts.applications ?? { data: [], error: null });
  const transQ = makeQuery(opts.transitions ?? { data: [], error: null });

  mockFrom.mockImplementation((table: string) => {
    if (table === "ai_audit_log") return auditQ;
    if (table === "applications") return appsQ;
    if (table === "application_transitions") return transQ;
    throw new Error(`Unexpected supabase.from(${table})`);
  });

  return { auditQ, appsQ, transQ };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchAuditLog", () => {
  it("returns entries with the campaign title and candidate name resolved", async () => {
    wireTables({ audit: { data: [AUDIT_ROW], error: null, count: 1 } });

    const { entries, total } = await fetchAuditLog("user-1");

    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({
      id: "aud-1",
      campaign_title: "Backend Engineer",
      candidate_name: "Ada Lovelace",
      prompt_version: "v1",
    });
  });

  it("scopes to the caller's own campaigns", async () => {
    // The audit trail carries raw model output and candidate names — it is the
    // last thing that should leak across accounts.
    const { auditQ } = wireTables({ audit: { data: [], error: null, count: 0 } });

    await fetchAuditLog("user-1");

    expect(auditQ.eq).toHaveBeenCalledWith("campaigns.user_id", "user-1");
    expect(auditQ.is).toHaveBeenCalledWith("campaigns.deleted_at", null);
  });

  it("joins candidates as a LEFT join so pre-candidate rows survive", async () => {
    // `candidate_id` is null for résumé parsing, which logs before a candidate
    // row exists. An inner join there would drop the earliest evidence in a
    // candidate's history — exactly what an audit needs most.
    const { auditQ } = wireTables({ audit: { data: [], error: null, count: 0 } });

    await fetchAuditLog("user-1");

    const select = auditQ.calls.find((c) => c.method === "select")?.args[0] as string;
    expect(select).toContain("candidates(");
    expect(select).not.toContain("candidates!inner");
  });

  it("narrows by campaign, stage, and date range when filtered", async () => {
    const { auditQ } = wireTables({ audit: { data: [], error: null, count: 0 } });

    await fetchAuditLog("user-1", {
      campaignId: "camp-9",
      stage: "interview_scoring",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-19T00:00:00.000Z",
    });

    expect(auditQ.eq).toHaveBeenCalledWith("campaign_id", "camp-9");
    expect(auditQ.eq).toHaveBeenCalledWith("stage", "interview_scoring");
    expect(auditQ.gte).toHaveBeenCalledWith("created_at", "2026-08-01T00:00:00.000Z");
    expect(auditQ.lt).toHaveBeenCalledWith("created_at", "2026-08-19T00:00:00.000Z");
  });

  it("returns newest first", async () => {
    const { auditQ } = wireTables({ audit: { data: [], error: null, count: 0 } });

    await fetchAuditLog("user-1");

    expect(auditQ.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("pages with the requested size", async () => {
    const { auditQ } = wireTables({ audit: { data: [], error: null, count: 0 } });

    await fetchAuditLog("user-1", {}, 2, 25);

    expect(auditQ.range).toHaveBeenCalledWith(50, 74);
  });

  it("degrades to an empty page on a query error rather than throwing", async () => {
    wireTables({ audit: { data: null, error: { message: "boom" } } });

    await expect(fetchAuditLog("user-1")).resolves.toEqual({ entries: [], total: 0 });
  });

  describe("recruiter action pairing", () => {
    const APPS = { data: [{ id: "app-1", campaign_id: "camp-1", candidate_id: "cand-1" }], error: null };

    it("attaches the nearest recruiter transition after the AI decision", async () => {
      wireTables({
        audit: { data: [AUDIT_ROW], error: null, count: 1 },
        applications: APPS,
        transitions: {
          data: [
            {
              application_id: "app-1",
              from_state: "resume_scored",
              to_state: "screening_rejected",
              rationale: "Not a fit despite the score",
              disposition_code: "OVERRIDE_REJECTED",
              created_at: "2026-08-18T12:00:00.000Z",
            },
          ],
          error: null,
        },
      });

      const { entries } = await fetchAuditLog("user-1");

      expect(entries[0].recruiter_action_after).toMatchObject({
        to_state: "screening_rejected",
        disposition_code: "OVERRIDE_REJECTED",
      });
    });

    it("ignores a recruiter action that happened BEFORE the AI decision", async () => {
      // A prior action didn't respond to evidence that didn't exist yet.
      wireTables({
        audit: { data: [AUDIT_ROW], error: null, count: 1 },
        applications: APPS,
        transitions: {
          data: [
            {
              application_id: "app-1",
              from_state: "new",
              to_state: "resume_parsed",
              rationale: "Manual advance",
              disposition_code: null,
              created_at: "2026-08-18T09:00:00.000Z",
            },
          ],
          error: null,
        },
      });

      const { entries } = await fetchAuditLog("user-1");

      expect(entries[0].recruiter_action_after).toBeNull();
    });

    it("only pairs recruiter-actor transitions, never system or AI ones", async () => {
      const { transQ } = wireTables({
        audit: { data: [AUDIT_ROW], error: null, count: 1 },
        applications: APPS,
      });

      await fetchAuditLog("user-1");

      expect(transQ.eq).toHaveBeenCalledWith("actor", "recruiter");
    });

    it("leaves the pairing null when nothing followed", async () => {
      wireTables({ audit: { data: [AUDIT_ROW], error: null, count: 1 }, applications: APPS });

      const { entries } = await fetchAuditLog("user-1");

      expect(entries[0].recruiter_action_after).toBeNull();
    });
  });

  it("keeps only acted-on rows when overriddenOnly is set", async () => {
    wireTables({
      audit: {
        data: [AUDIT_ROW, { ...AUDIT_ROW, id: "aud-2", candidate_id: "cand-2" }],
        error: null,
        count: 2,
      },
      applications: {
        data: [{ id: "app-1", campaign_id: "camp-1", candidate_id: "cand-1" }],
        error: null,
      },
      transitions: {
        data: [
          {
            application_id: "app-1",
            from_state: "resume_scored",
            to_state: "screening_rejected",
            rationale: "Overridden",
            disposition_code: "OVERRIDE_REJECTED",
            created_at: "2026-08-18T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const { entries, total } = await fetchAuditLog("user-1", { overriddenOnly: true });

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("aud-1");
    // Total must reflect the filtered set, or the pager offers empty pages.
    expect(total).toBe(1);
  });
});
