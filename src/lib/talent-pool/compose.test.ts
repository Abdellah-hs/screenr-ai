import { describe, expect, it } from "vitest";
import type {
  PooledCandidateEvidenceRow,
  TalentPoolEntryRow,
} from "@/lib/data/talent-pool-entries";
import { composeTalentPoolEntries } from "./compose";

function entryRow(overrides: Partial<TalentPoolEntryRow> = {}): TalentPoolEntryRow {
  return {
    id: "entry-1",
    candidate_id: "cand-1",
    source_application_id: "app-1",
    source_campaign_id: "camp-1",
    tags: ["react"],
    notes: "Strong second choice",
    added_at: "2026-08-10T09:00:00.000Z",
    candidates: {
      id: "cand-1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: null,
      location: "Berlin",
    },
    campaigns: { id: "camp-1", title: "Backend Engineer" },
    ...overrides,
  };
}

function evidenceRow(
  overrides: Partial<PooledCandidateEvidenceRow> = {},
): PooledCandidateEvidenceRow {
  return {
    candidate_id: "cand-1",
    campaign_id: "camp-1",
    created_at: "2026-08-01T09:00:00.000Z",
    resume_score: 70,
    screening_score: null,
    interview_score: null,
    parsed_data: null,
    campaigns: { id: "camp-1", title: "Backend Engineer" },
    ...overrides,
  };
}

describe("composeTalentPoolEntries", () => {
  it("carries the curation and the person through", () => {
    const result = composeTalentPoolEntries([entryRow()], [evidenceRow()]);

    expect(result[0]).toMatchObject({
      id: "entry-1",
      candidateId: "cand-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      location: "Berlin",
      tags: ["react"],
      notes: "Strong second choice",
      sourceCampaignTitle: "Backend Engineer",
    });
  });

  it("falls back to the email when the person has no name on file", () => {
    const row = entryRow({
      candidates: {
        id: "cand-1",
        first_name: "",
        last_name: "",
        email: "unknown@example.com",
        phone: null,
        location: null,
      },
    });

    expect(composeTalentPoolEntries([row], [])[0].name).toBe("unknown@example.com");
  });

  it("takes the best score across every stage and every application", () => {
    const evidence = [
      evidenceRow({ campaign_id: "camp-2", resume_score: 55, interview_score: 91 }),
      evidenceRow({ campaign_id: "camp-1", resume_score: 70, screening_score: 64 }),
    ];

    expect(composeTalentPoolEntries([entryRow()], evidence)[0].bestScore).toBe(91);
  });

  it("reports no score rather than zero when nothing was ever scored", () => {
    // Zero would place an unmeasured person at the bottom of a score filter,
    // which reads as "we scored them and they failed".
    const evidence = [
      evidenceRow({ resume_score: null, screening_score: null, interview_score: null }),
    ];

    expect(composeTalentPoolEntries([entryRow()], evidence)[0].bestScore).toBeNull();
  });

  it("lifts headline and skills from the most recent parsed resume", () => {
    // Evidence arrives newest-first from the data layer.
    const evidence = [
      evidenceRow({
        campaign_id: "camp-2",
        parsed_data: { headline: "Staff Engineer", skills: ["Go", "Kubernetes"] },
      }),
      evidenceRow({
        campaign_id: "camp-1",
        parsed_data: { headline: "Senior Engineer", skills: ["Python"] },
      }),
    ];

    const result = composeTalentPoolEntries([entryRow()], evidence)[0];

    expect(result.headline).toBe("Staff Engineer");
    expect(result.skills).toEqual(["Go", "Kubernetes"]);
  });

  it("keeps an older parse when the newest application never parsed", () => {
    const evidence = [
      evidenceRow({ campaign_id: "camp-2", parsed_data: null }),
      evidenceRow({
        campaign_id: "camp-1",
        parsed_data: { headline: "Senior Engineer", skills: ["Python"] },
      }),
    ];

    const result = composeTalentPoolEntries([entryRow()], evidence)[0];

    expect(result.headline).toBe("Senior Engineer");
    expect(result.skills).toEqual(["Python"]);
  });

  it("ignores malformed parsed_data instead of throwing", () => {
    const evidence = [
      evidenceRow({ parsed_data: { headline: 42, skills: "python" } }),
    ];

    const result = composeTalentPoolEntries([entryRow()], evidence)[0];

    expect(result.headline).toBeNull();
    expect(result.skills).toEqual([]);
  });

  it("lists every campaign the person applied to, deduped", () => {
    const evidence = [
      evidenceRow({ campaign_id: "camp-2", campaigns: { id: "camp-2", title: "Platform" } }),
      evidenceRow({ campaign_id: "camp-1" }),
      evidenceRow({ campaign_id: "camp-1" }),
    ];

    const result = composeTalentPoolEntries([entryRow()], evidence)[0];

    expect(result.campaigns).toEqual([
      { id: "camp-2", title: "Platform" },
      { id: "camp-1", title: "Backend Engineer" },
    ]);
  });

  /**
   * A pool whose people vanish when their campaign is removed is not a pool.
   * The source campaign stays as a filter option even with no evidence behind
   * it, so "everyone I pooled from that closed role" still answers.
   */
  it("keeps a soft-removed source campaign as a filter option", () => {
    const result = composeTalentPoolEntries([entryRow()], []);

    expect(result[0].campaigns).toEqual([{ id: "camp-1", title: "Backend Engineer" }]);
    expect(result[0].bestScore).toBeNull();
  });

  it("survives an entry whose source campaign was hard-deleted", () => {
    const row = entryRow({ campaigns: null, source_campaign_id: null });

    const result = composeTalentPoolEntries([row], []);

    expect(result).toHaveLength(1);
    expect(result[0].sourceCampaignTitle).toBeNull();
    expect(result[0].campaigns).toEqual([]);
  });

  it("does not bleed one person's evidence into another's", () => {
    const entries = [
      entryRow({ id: "e1", candidate_id: "cand-1" }),
      entryRow({
        id: "e2",
        candidate_id: "cand-2",
        candidates: {
          id: "cand-2",
          first_name: "Grace",
          last_name: "Hopper",
          email: "grace@example.com",
          phone: null,
          location: null,
        },
      }),
    ];
    const evidence = [
      evidenceRow({ candidate_id: "cand-1", resume_score: 95 }),
      evidenceRow({ candidate_id: "cand-2", resume_score: 40 }),
    ];

    const result = composeTalentPoolEntries(entries, evidence);

    expect(result.map((e) => e.bestScore)).toEqual([95, 40]);
  });
});
