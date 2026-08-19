import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMaybeSingle = vi.fn();
const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({ select: mockSelect, upsert: mockUpsert }));

const mockSupabase = { from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import { fetchCachedResumeEvidence, saveCachedResumeEvidence } from "./resume-evidence-cache";
import type { ResumeEvidenceResponse } from "@/lib/resume-scoring";

const EVIDENCE: ResumeEvidenceResponse = {
  criteria: [
    {
      criterion_label: "TypeScript",
      evidence_level: "strong",
      evidence_items: [
        {
          quote: "Built APIs using TypeScript.",
          source_section: "experience",
          explanation: "Concrete use.",
        },
      ],
      extracted_relevant_months: 24,
      notes: null,
    },
  ],
  extraction_summary: "Strong TypeScript.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCachedResumeEvidence", () => {
  it("looks the row up by cache key and returns the stored extraction", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        extracted_evidence: EVIDENCE,
        raw_model_output: "{}",
        model: "gpt-4o-mini",
        prompt_version: "v3_resume_evidence",
        system_fingerprint: "fp_abc",
      },
    });

    const cached = await fetchCachedResumeEvidence("key-1");

    expect(mockFrom).toHaveBeenCalledWith("resume_evidence_cache");
    expect(mockSelectEq).toHaveBeenCalledWith("cache_key", "key-1");
    expect(cached).toEqual({
      evidence: EVIDENCE,
      rawOutput: "{}",
      model: "gpt-4o-mini",
      promptVersion: "v3_resume_evidence",
      systemFingerprint: "fp_abc",
    });
  });

  it("returns null on a miss", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });

    expect(await fetchCachedResumeEvidence("key-1")).toBeNull();
  });

  it("treats a row written under an older shape as a miss rather than throwing", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        extracted_evidence: { factors: [{ name: "TypeScript", score: 72 }] },
        raw_model_output: "{}",
        model: "gpt-4o-mini",
        prompt_version: "v2_resume_scoring",
        system_fingerprint: null,
      },
    });

    expect(await fetchCachedResumeEvidence("key-1")).toBeNull();
  });
});

describe("saveCachedResumeEvidence", () => {
  const args = {
    cacheKey: "key-1",
    campaignId: "camp-1",
    resumeTextHash: "hash-1",
    model: "gpt-4o-mini",
    promptVersion: "v3_resume_evidence",
    rulesVersion: "v1_must_have_gate",
    rubricVersion: 3,
    systemFingerprint: "fp_abc",
    rawOutput: "{}",
    evidence: EVIDENCE,
  };

  it("upserts on the cache key so a concurrent scorer is a no-op, not a crash", async () => {
    mockUpsert.mockResolvedValue({ error: null });

    await saveCachedResumeEvidence(args);

    expect(mockFrom).toHaveBeenCalledWith("resume_evidence_cache");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cache_key: "key-1",
        campaign_id: "camp-1",
        resume_text_hash: "hash-1",
        rules_version: "v1_must_have_gate",
        rubric_version: 3,
        extracted_evidence: EVIDENCE,
      }),
      { onConflict: "cache_key" },
    );
  });

  it("swallows a write failure — a cache miss must never fail the scoring run", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "RLS denied" } });

    await expect(saveCachedResumeEvidence(args)).resolves.toBeUndefined();
  });
});
