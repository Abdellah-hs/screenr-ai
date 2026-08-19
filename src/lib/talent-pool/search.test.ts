import { describe, expect, it } from "vitest";
import { EMPTY_TALENT_POOL_FILTERS, type TalentPoolEntry } from "@/lib/constants";
import { collectPoolTags, filterTalentPool, normalizePoolTags } from "./search";

function entry(overrides: Partial<TalentPoolEntry> = {}): TalentPoolEntry {
  return {
    id: "entry-1",
    candidateId: "cand-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: null,
    location: null,
    headline: "Senior Backend Engineer",
    skills: ["Python", "Postgres"],
    tags: ["react"],
    notes: null,
    addedAt: "2026-08-10T09:00:00.000Z",
    sourceApplicationId: "app-1",
    sourceCampaignId: "camp-1",
    sourceCampaignTitle: "Backend Engineer",
    bestScore: 82,
    campaigns: [{ id: "camp-1", title: "Backend Engineer" }],
    ...overrides,
  };
}

const NO_FILTERS = EMPTY_TALENT_POOL_FILTERS;

describe("filterTalentPool", () => {
  it("returns everything when no filter is set", () => {
    const entries = [entry({ id: "a" }), entry({ id: "b" })];

    expect(filterTalentPool(entries, NO_FILTERS)).toHaveLength(2);
  });

  it("matches a free-text query against the name", () => {
    const entries = [
      entry({ id: "a", name: "Ada Lovelace" }),
      entry({ id: "b", name: "Grace Hopper" }),
    ];

    const result = filterTalentPool(entries, { ...NO_FILTERS, query: "grace" });

    expect(result.map((e) => e.id)).toEqual(["b"]);
  });

  it("searches skills, notes and tags, not just the name", () => {
    // The 3.11.2 question is "who knows Kubernetes", and the answer lives in a
    // parsed resume or a recruiter's note, never in the person's name.
    const kubernetes = entry({ id: "skill", name: "A", skills: ["Kubernetes"] });
    const noted = entry({ id: "note", name: "B", skills: [], notes: "Strong on Kubernetes" });
    const tagged = entry({ id: "tag", name: "C", skills: [], tags: ["kubernetes"] });
    const other = entry({ id: "other", name: "D", skills: ["COBOL"], tags: [] });

    const result = filterTalentPool([kubernetes, noted, tagged, other], {
      ...NO_FILTERS,
      query: "kubernetes",
    });

    expect(result.map((e) => e.id)).toEqual(["skill", "note", "tag"]);
  });

  it("requires every selected tag, so a second tag narrows the list", () => {
    const both = entry({ id: "both", tags: ["react", "senior"] });
    const one = entry({ id: "one", tags: ["react"] });

    const result = filterTalentPool([both, one], {
      ...NO_FILTERS,
      tags: ["react", "senior"],
    });

    expect(result.map((e) => e.id)).toEqual(["both"]);
  });

  it("matches tags case-insensitively", () => {
    const e = entry({ tags: ["React"] });

    expect(filterTalentPool([e], { ...NO_FILTERS, tags: ["react"] })).toHaveLength(1);
  });

  it("filters by any campaign the person applied to, not only the source", () => {
    // Someone pooled from one role but who also applied to another must surface
    // under both — the filter asks where they came from, and both are true.
    const e = entry({
      sourceCampaignId: "camp-1",
      campaigns: [
        { id: "camp-1", title: "Backend Engineer" },
        { id: "camp-2", title: "Platform Engineer" },
      ],
    });

    expect(filterTalentPool([e], { ...NO_FILTERS, campaignId: "camp-2" })).toHaveLength(1);
    expect(filterTalentPool([e], { ...NO_FILTERS, campaignId: "camp-3" })).toHaveLength(0);
  });

  it("applies score bounds inclusively at both ends", () => {
    const low = entry({ id: "low", bestScore: 60 });
    const mid = entry({ id: "mid", bestScore: 75 });
    const high = entry({ id: "high", bestScore: 90 });

    const result = filterTalentPool([low, mid, high], {
      ...NO_FILTERS,
      minScore: 60,
      maxScore: 90,
    });

    expect(result.map((e) => e.id)).toEqual(["low", "mid", "high"]);
  });

  /**
   * "Never scored" is not a low score. Sliding a max-only bound down must not
   * quietly sweep unmeasured people into a result set that asserts they scored
   * badly.
   */
  it("excludes unscored people whenever a score bound is set — including max-only", () => {
    const unscored = entry({ id: "unscored", bestScore: null });

    expect(filterTalentPool([unscored], { ...NO_FILTERS, maxScore: 60 })).toEqual([]);
    expect(filterTalentPool([unscored], { ...NO_FILTERS, minScore: 10 })).toEqual([]);
    // …but an unbounded view still shows them.
    expect(filterTalentPool([unscored], NO_FILTERS)).toHaveLength(1);
  });

  it("includes people added on the boundary day itself", () => {
    // The bug this guards: comparing a timestamp to a bare date excludes
    // everything added after midnight on the `to` day.
    const e = entry({ addedAt: "2026-08-05T23:30:00.000Z" });

    const result = filterTalentPool([e], {
      ...NO_FILTERS,
      addedFrom: "2026-08-05",
      addedTo: "2026-08-05",
    });

    expect(result).toHaveLength(1);
  });

  it("excludes entries outside the added-date window", () => {
    const early = entry({ id: "early", addedAt: "2026-07-01T09:00:00.000Z" });
    const late = entry({ id: "late", addedAt: "2026-09-01T09:00:00.000Z" });
    const inside = entry({ id: "inside", addedAt: "2026-08-10T09:00:00.000Z" });

    const result = filterTalentPool([early, late, inside], {
      ...NO_FILTERS,
      addedFrom: "2026-08-01",
      addedTo: "2026-08-31",
    });

    expect(result.map((e) => e.id)).toEqual(["inside"]);
  });

  it("combines axes with AND", () => {
    const match = entry({ id: "match", tags: ["senior"], bestScore: 88, name: "Ada Match" });
    const wrongTag = entry({ id: "wrong-tag", tags: ["junior"], bestScore: 88, name: "Ada Two" });
    const wrongScore = entry({ id: "wrong-score", tags: ["senior"], bestScore: 40, name: "Ada Three" });

    const result = filterTalentPool([match, wrongTag, wrongScore], {
      ...NO_FILTERS,
      query: "ada",
      tags: ["senior"],
      minScore: 70,
    });

    expect(result.map((e) => e.id)).toEqual(["match"]);
  });
});

describe("collectPoolTags", () => {
  it("counts each tag across the pool, most-used first", () => {
    const entries = [
      entry({ id: "a", tags: ["react", "senior"] }),
      entry({ id: "b", tags: ["react"] }),
      entry({ id: "c", tags: ["golang"] }),
    ];

    expect(collectPoolTags(entries)).toEqual([
      { tag: "react", count: 2 },
      { tag: "golang", count: 1 },
      { tag: "senior", count: 1 },
    ]);
  });

  it("folds case variants into one tag but keeps the spelling first seen", () => {
    // Lowercasing the label would render a recruiter's "Python" as "python".
    const entries = [entry({ id: "a", tags: ["Python"] }), entry({ id: "b", tags: ["python"] })];

    expect(collectPoolTags(entries)).toEqual([{ tag: "Python", count: 2 }]);
  });

  it("counts a tag once per entry even if stored twice on that row", () => {
    const entries = [entry({ id: "a", tags: ["react", "React"] })];

    expect(collectPoolTags(entries)).toEqual([{ tag: "react", count: 1 }]);
  });

  it("returns nothing for an untagged pool", () => {
    expect(collectPoolTags([entry({ tags: [] })])).toEqual([]);
  });
});

describe("normalizePoolTags", () => {
  it("trims, drops empties, and dedupes case-insensitively", () => {
    expect(normalizePoolTags(["  react ", "React", "", "   ", "senior"])).toEqual([
      "react",
      "senior",
    ]);
  });

  it("preserves the order the recruiter typed", () => {
    expect(normalizePoolTags(["senior", "react"])).toEqual(["senior", "react"]);
  });
});
