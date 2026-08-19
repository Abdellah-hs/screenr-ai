import { describe, expect, it } from "vitest";
import type { Candidate } from "@/lib/constants";
import {
  candidateStageCounts,
  selectCandidates,
  type CandidateTableView,
} from "./table-view";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "app-1",
    campaign_id: "camp-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: null,
    current_title: "Backend Engineer",
    current_company: "Analytical Ltd",
    stage: "screening",
    status: "screening_scored",
    awaiting_human_review: false,
    is_archived: false,
    sla: null,
    scores: [],
    resume: { skills: [], experience_years: 0, education: "Unknown" },
    applied_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-10T09:00:00.000Z",
    ...overrides,
  };
}

const DEFAULT_VIEW: CandidateTableView = {
  search: "",
  stageFilter: "all",
  overdueOnly: false,
  sort: "applied_at",
};

function view(overrides: Partial<CandidateTableView> = {}): CandidateTableView {
  return { ...DEFAULT_VIEW, ...overrides };
}

describe("selectCandidates — stage filter", () => {
  it("returns everyone under the 'all' pill", () => {
    const list = [candidate({ id: "a" }), candidate({ id: "b", stage: "hired" })];

    expect(selectCandidates(list, view())).toHaveLength(2);
  });

  it("narrows to one pipeline bucket", () => {
    const list = [
      candidate({ id: "screening", stage: "screening" }),
      candidate({ id: "interview", stage: "interview" }),
    ];

    const result = selectCandidates(list, view({ stageFilter: "interview" }));

    expect(result.map((c) => c.id)).toEqual(["interview"]);
  });

  it("treats pending review as a flag, not a stage", () => {
    // The application is still in `screening`; awaiting review is a workflow
    // state on top of it, which is why it gets a banner rather than a pill.
    const list = [
      candidate({ id: "pending", stage: "screening", awaiting_human_review: true }),
      candidate({ id: "plain", stage: "screening" }),
    ];

    const result = selectCandidates(list, view({ stageFilter: "pending_review" }));

    expect(result.map((c) => c.id)).toEqual(["pending"]);
  });

  /**
   * An archived application files under the `rejected` bucket. If the Rejected
   * pill also showed them, a recruiter reviewing rejections would be reading
   * people who timed out as people who were turned down.
   */
  it("keeps Rejected and Archived disjoint", () => {
    const list = [
      candidate({ id: "rejected", stage: "rejected" }),
      candidate({ id: "archived", stage: "rejected", is_archived: true }),
    ];

    expect(
      selectCandidates(list, view({ stageFilter: "rejected" })).map((c) => c.id),
    ).toEqual(["rejected"]);
    expect(
      selectCandidates(list, view({ stageFilter: "archived" })).map((c) => c.id),
    ).toEqual(["archived"]);
  });
});

describe("selectCandidates — overdue narrowing", () => {
  it("keeps only breaching rows when enabled", () => {
    const list = [
      candidate({ id: "late", sla: { level: "alert", hours: 40 } }),
      candidate({ id: "fine", sla: null }),
    ];

    const result = selectCandidates(list, view({ overdueOnly: true }));

    expect(result.map((c) => c.id)).toEqual(["late"]);
  });

  /**
   * The bell links to `?overdue=1&stage=screening`. If the two narrowings were
   * mutually exclusive, that link could not express what it counted.
   */
  it("combines with the stage pill rather than replacing it", () => {
    const list = [
      candidate({ id: "match", stage: "screening", sla: { level: "alert", hours: 40 } }),
      candidate({ id: "wrong-stage", stage: "interview", sla: { level: "alert", hours: 40 } }),
      candidate({ id: "not-late", stage: "screening", sla: null }),
    ];

    const result = selectCandidates(
      list,
      view({ overdueOnly: true, stageFilter: "screening" }),
    );

    expect(result.map((c) => c.id)).toEqual(["match"]);
  });

  it("is inert when disabled", () => {
    const list = [candidate({ id: "fine", sla: null })];

    expect(selectCandidates(list, view({ overdueOnly: false }))).toHaveLength(1);
  });
});

describe("selectCandidates — search", () => {
  it("matches name, email, title and company", () => {
    const list = [
      candidate({ id: "name", name: "Grace Hopper", email: "g@x.com", current_title: null, current_company: null }),
      candidate({ id: "email", name: "A", email: "hopper@x.com", current_title: null, current_company: null }),
      candidate({ id: "title", name: "B", email: "b@x.com", current_title: "Hopper Specialist", current_company: null }),
      candidate({ id: "company", name: "C", email: "c@x.com", current_title: null, current_company: "Hopper Inc" }),
      candidate({ id: "miss", name: "D", email: "d@x.com", current_title: null, current_company: null }),
    ];

    const result = selectCandidates(list, view({ search: "hopper" }));

    expect(result.map((c) => c.id).sort()).toEqual(["company", "email", "name", "title"]);
  });

  it("ignores case and surrounding whitespace", () => {
    const list = [candidate({ name: "Ada Lovelace" })];

    expect(selectCandidates(list, view({ search: "  ADA  " }))).toHaveLength(1);
  });

  it("does not filter on an empty query", () => {
    const list = [candidate({ id: "a" }), candidate({ id: "b" })];

    expect(selectCandidates(list, view({ search: "   " }))).toHaveLength(2);
  });
});

describe("selectCandidates — sorting", () => {
  it("puts the newest application first by default", () => {
    const list = [
      candidate({ id: "old", applied_at: "2026-07-01T09:00:00.000Z" }),
      candidate({ id: "new", applied_at: "2026-08-01T09:00:00.000Z" }),
    ];

    expect(selectCandidates(list, view()).map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("sorts by name A-Z", () => {
    const list = [candidate({ id: "z", name: "Zoe" }), candidate({ id: "a", name: "Ada" })];

    expect(selectCandidates(list, view({ sort: "name" })).map((c) => c.id)).toEqual([
      "a",
      "z",
    ]);
  });

  it("sorts by stage score, highest first", () => {
    const score = (overall: number) => [
      {
        stage: "screening" as const,
        overall,
        // `tier` is optional and never null on the domain type — omitted.
        ai_summary: "",
        factors: [],
        scored_at: "2026-08-10T09:00:00.000Z",
        rubric_version: null,
        current_rubric_version: null,
      },
    ];
    const list = [
      candidate({ id: "low", scores: score(40) }),
      candidate({ id: "high", scores: score(90) }),
    ];

    expect(selectCandidates(list, view({ sort: "score" })).map((c) => c.id)).toEqual([
      "high",
      "low",
    ]);
  });

  /**
   * "Longest in stage" sorts on the last-activity timestamp, not on `sla.hours`
   * — so rows with no breach still order sensibly among themselves instead of
   * collapsing into one tie at the bottom.
   */
  it("puts the stalest application first under stage_age, breach or not", () => {
    const list = [
      candidate({ id: "fresh", updated_at: "2026-08-18T09:00:00.000Z", sla: null }),
      candidate({
        id: "stale",
        updated_at: "2026-08-01T09:00:00.000Z",
        sla: { level: "escalation", hours: 400 },
      }),
      candidate({ id: "middle", updated_at: "2026-08-10T09:00:00.000Z", sla: null }),
    ];

    expect(
      selectCandidates(list, view({ sort: "stage_age" })).map((c) => c.id),
    ).toEqual(["stale", "middle", "fresh"]);
  });

  it("does not mutate the input array's order", () => {
    // `.sort()` is in-place; the source list is a React prop.
    const list = [
      candidate({ id: "a", name: "Zoe" }),
      candidate({ id: "b", name: "Ada" }),
    ];

    selectCandidates(list, view({ sort: "name" }));

    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("candidateStageCounts", () => {
  it("counts the total, each bucket, and both banners", () => {
    const list = [
      candidate({ stage: "screening", awaiting_human_review: true }),
      candidate({ stage: "screening", sla: { level: "alert", hours: 40 } }),
      candidate({ stage: "interview" }),
    ];

    const counts = candidateStageCounts(list);

    expect(counts).toMatchObject({
      all: 3,
      screening: 2,
      interview: 1,
      pending_review: 1,
      overdue: 1,
    });
  });

  it("subtracts archived rows out of the rejected count", () => {
    // Otherwise the pill row double-counts and the numbers stop adding up.
    const list = [
      candidate({ stage: "rejected" }),
      candidate({ stage: "rejected", is_archived: true }),
    ];

    const counts = candidateStageCounts(list);

    expect(counts.rejected).toBe(1);
    expect(counts.archived).toBe(1);
  });

  it("reports zero overdue when no campaign SLA is configured", () => {
    expect(candidateStageCounts([candidate({ sla: null })]).overdue).toBe(0);
  });
});
