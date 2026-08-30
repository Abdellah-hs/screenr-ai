import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/data/candidates", () => ({ saveResumeScore: vi.fn() }));
vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignScoringConfig: vi.fn(),
  fetchActiveRubricVersion: vi.fn(),
}));
vi.mock("@/lib/data/resume-evidence-cache", () => ({
  fetchCachedResumeEvidence: vi.fn(),
  saveCachedResumeEvidence: vi.fn(),
}));
vi.mock("@/lib/services/openai", () => ({
  extractResumeEvidence: vi.fn(),
  RESUME_EVIDENCE_MODEL: "gpt-4o-mini",
  RESUME_EVIDENCE_PROMPT_VERSION: "v4_resume_evidence",
}));

import { evaluateApplicationResume } from "./score-resume";
import { saveResumeScore } from "@/lib/data/candidates";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import {
  fetchCachedResumeEvidence,
  saveCachedResumeEvidence,
} from "@/lib/data/resume-evidence-cache";
import { extractResumeEvidence } from "@/lib/services/openai";
import type { ResumeEvidenceResponse } from "@/lib/resume-scoring";

const mockSaveScore = vi.mocked(saveResumeScore);
const mockFetchConfig = vi.mocked(fetchCampaignScoringConfig);
const mockFetchRubric = vi.mocked(fetchActiveRubricVersion);
const mockFetchCache = vi.mocked(fetchCachedResumeEvidence);
const mockSaveCache = vi.mocked(saveCachedResumeEvidence);
const mockExtract = vi.mocked(extractResumeEvidence);

const PARSED = {
  first_name: "Ada",
  last_name: "Lovelace",
  skills: ["TypeScript"],
  experience: [
    {
      company: "Acme",
      title: "Engineer",
      duration: "2019-2024",
      description: "Built APIs using TypeScript.",
    },
  ],
};

function evidence(over: Partial<ResumeEvidenceResponse> = {}): ResumeEvidenceResponse {
  return {
    criteria: [
      {
        criterion_label: "TypeScript",
        evidence_level: "strong",
        evidence_items: [
          {
            quote: "Built APIs using TypeScript.",
            source_section: "experience",
            explanation: "Concrete professional use.",
          },
        ],
        extracted_relevant_months: null,
        notes: null,
      },
      {
        criterion_label: "Testing",
        evidence_level: "weak",
        evidence_items: [
          {
            quote: "TypeScript",
            source_section: "skills",
            explanation: "Listed as a skill only.",
          },
        ],
        extracted_relevant_months: null,
        notes: null,
      },
    ],
    extraction_summary: "Solid TypeScript, thin testing.",
    ...over,
  };
}

function args(over: Record<string, unknown> = {}) {
  return {
    applicationId: "app-1",
    campaignId: "camp-1",
    candidateId: "cand-1",
    ownerUserId: "user-1",
    parsedResume: PARSED as Record<string, unknown>,
    source: "apply_form",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFetchConfig.mockResolvedValue({
    id: "camp-1",
    description: "Senior engineer",
    automation_mode: "fully_auto",
    resume_threshold: 70,
    // Diverging on purpose: the resume path must read the CV bar. The rule's
    // CampaignScoringConfig does not even declare screening_threshold, so this
    // value exists only to make a regression obvious if that ever loosens.
    screening_threshold: 95,
    screening_criteria: [
      { id: "c1", label: "TypeScript", priority: "must_have" },
      { id: "c2", label: "Testing", priority: "nice_to_have" },
    ],
  });
  mockFetchRubric.mockResolvedValue(3);
  mockFetchCache.mockResolvedValue(null);
  mockSaveCache.mockResolvedValue(undefined);
  mockExtract.mockResolvedValue({
    evidence: evidence(),
    rawOutput: "{}",
    model: "gpt-4o-mini",
    promptVersion: "v3_resume_evidence",
    systemFingerprint: "fp_abc",
  });
  mockSaveScore.mockResolvedValue(undefined);
});

describe("evaluateApplicationResume", () => {
  it("returns null without calling the model when the campaign has no criteria", async () => {
    mockFetchConfig.mockResolvedValue({
      id: "camp-1",
      description: "Senior engineer",
      automation_mode: "fully_auto",
      resume_threshold: 70,
      screening_threshold: 95,
      screening_criteria: [],
    });

    expect(await evaluateApplicationResume(args())).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockSaveScore).not.toHaveBeenCalled();
  });

  it("returns null when the campaign cannot be loaded", async () => {
    mockFetchConfig.mockResolvedValue(null);

    expect(await evaluateApplicationResume(args())).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("scores deterministically from the extracted evidence", async () => {
    const outcome = await evaluateApplicationResume(args());

    // TypeScript strong (80) clears the must-have gate, and its evidence counts
    // toward the ranking alongside Testing weak (25): (80 + 25) / 2 = 52.5 → 53.
    expect(outcome?.result.eligible).toBe(true);
    expect(outcome?.result.ranking_score).toBe(53);
    expect(outcome?.result.tier).toBe("eligible");
  });

  it("gates on the must-have regardless of how the nice-to-have scored", async () => {
    mockExtract.mockResolvedValue({
      evidence: evidence({
        criteria: [
          {
            criterion_label: "TypeScript",
            evidence_level: "weak",
            evidence_items: [
              { quote: "TypeScript", source_section: "skills", explanation: "Listed only." },
            ],
            extracted_relevant_months: null,
            notes: null,
          },
          {
            criterion_label: "Testing",
            evidence_level: "very_strong",
            evidence_items: [
              {
                quote: "Built APIs using TypeScript.",
                source_section: "experience",
                explanation: "Repeated work.",
              },
            ],
            extracted_relevant_months: null,
            notes: null,
          },
        ],
      }),
      rawOutput: "{}",
      model: "gpt-4o-mini",
      promptVersion: "v3_resume_evidence",
      systemFingerprint: null,
    });

    const outcome = await evaluateApplicationResume(args());

    expect(outcome?.result.eligible).toBe(false);
    expect(outcome?.result.ranking_score).toBeNull();
  });

  it("downgrades a criterion whose quote is not in the resume", async () => {
    mockExtract.mockResolvedValue({
      evidence: evidence({
        criteria: [
          {
            criterion_label: "TypeScript",
            evidence_level: "very_strong",
            evidence_items: [
              {
                quote: "Architected a distributed TypeScript platform for 40 teams.",
                source_section: "experience",
                explanation: "Fabricated.",
              },
            ],
            extracted_relevant_months: null,
            notes: null,
          },
          {
            criterion_label: "Testing",
            evidence_level: "not_present",
            evidence_items: [],
            extracted_relevant_months: null,
            notes: null,
          },
        ],
      }),
      rawOutput: "{}",
      model: "gpt-4o-mini",
      promptVersion: "v3_resume_evidence",
      systemFingerprint: null,
    });

    const outcome = await evaluateApplicationResume(args());

    expect(outcome?.result.criteria[0].evidence_level).toBe("unclear");
    expect(outcome?.result.eligible).toBe(false);
    expect(outcome?.result.validation_warnings.length).toBeGreaterThan(0);
  });

  it("persists the score with the full audit snapshot", async () => {
    await evaluateApplicationResume(args());

    expect(mockSaveScore).toHaveBeenCalledTimes(1);
    const saved = mockSaveScore.mock.calls[0][0];

    expect(saved).toMatchObject({
      applicationId: "app-1",
      campaignId: "camp-1",
      candidateId: "cand-1",
      rubricVersion: 3,
    });

    const snapshot = saved.audit.inputSnapshot as Record<string, unknown>;
    expect(snapshot.normalized_resume_text_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.system_fingerprint).toBe("fp_abc");
    expect(snapshot.cache_hit).toBe(false);
    expect(snapshot.source).toBe("apply_form");
    expect(snapshot.criteria).toEqual([
      { label: "TypeScript", priority: "must_have" },
      { label: "Testing", priority: "nice_to_have" },
    ]);
    expect(snapshot.extracted_evidence).toBeDefined();
    expect(snapshot.deterministic_result).toBeDefined();
    // The one thing an audit row must never carry.
    expect(JSON.stringify(snapshot)).not.toContain("OPENAI_API_KEY");
  });

  it("caches a fresh extraction under a 64-character key", async () => {
    await evaluateApplicationResume(args());

    expect(mockSaveCache).toHaveBeenCalledTimes(1);
    const cached = mockSaveCache.mock.calls[0][0];
    expect(cached.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    expect(cached.campaignId).toBe("camp-1");
    expect(cached.rulesVersion).toBe("v2_ranking_over_all_criteria");
  });

  it("reuses cached evidence instead of calling the model again", async () => {
    mockFetchCache.mockResolvedValue({
      evidence: evidence(),
      rawOutput: "{}",
      model: "gpt-4o-mini",
      promptVersion: "v3_resume_evidence",
      systemFingerprint: null,
    });

    const outcome = await evaluateApplicationResume(args());

    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockSaveCache).not.toHaveBeenCalled();
    expect(outcome?.result.eligible).toBe(true);
    // Scoring still ran: a cached result is re-derived, never replayed.
    expect(mockSaveScore).toHaveBeenCalledTimes(1);
    const snapshot = mockSaveScore.mock.calls[0][0].audit.inputSnapshot as Record<string, unknown>;
    expect(snapshot.cache_hit).toBe(true);
  });

  it("looks up a different cache key once a criterion changes priority", async () => {
    await evaluateApplicationResume(args());
    const firstKey = mockFetchCache.mock.calls[0][0];

    mockFetchConfig.mockResolvedValue({
      id: "camp-1",
      description: "Senior engineer",
      automation_mode: "fully_auto",
      resume_threshold: 70,
      screening_threshold: 95,
      screening_criteria: [
        { id: "c1", label: "TypeScript", priority: "must_have" },
        { id: "c2", label: "Testing", priority: "must_have" }, // was nice_to_have
      ],
    });

    await evaluateApplicationResume(args());

    expect(mockFetchCache.mock.calls[1][0]).not.toBe(firstKey);
  });

  it("looks up a different cache key when the raw resume text is supplied", async () => {
    await evaluateApplicationResume(args());
    const withoutRaw = mockFetchCache.mock.calls[0][0];

    await evaluateApplicationResume(args({ rawResumeText: "Original CV text." }));

    expect(mockFetchCache.mock.calls[1][0]).not.toBe(withoutRaw);
  });

  it("throws when the evidence does not line up with the criteria", async () => {
    mockExtract.mockResolvedValue({
      evidence: evidence({ criteria: [evidence().criteria[0]] }), // one short
      rawOutput: "{}",
      model: "gpt-4o-mini",
      promptVersion: "v3_resume_evidence",
      systemFingerprint: null,
    });

    await expect(evaluateApplicationResume(args())).rejects.toThrow(/criteria/);
    expect(mockSaveScore).not.toHaveBeenCalled();
  });
});
