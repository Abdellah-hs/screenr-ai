import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedResumeData } from "@/lib/services/openai";

vi.mock("@/lib/data/candidates", () => ({
  uploadResumeToStorage: vi.fn(),
  upsertCandidate: vi.fn(),
  createApplicationIfNotExists: vi.fn(),
  logAiAudit: vi.fn(),
  saveResumeScore: vi.fn(),
}));
vi.mock("@/lib/data/campaigns", () => ({
  fetchCampaignScoringConfig: vi.fn(),
  fetchActiveRubricVersion: vi.fn(),
}));
vi.mock("@/lib/services/marker", () => ({ extractMarkdownWithMarker: vi.fn() }));
vi.mock("@/lib/services/openai", () => ({
  extractResumeData: vi.fn(),
  scoreResumeAgainstCriteria: vi.fn(),
}));
vi.mock("@/lib/rules/resume-scoring", () => ({ evaluateResumeScoringOutcome: vi.fn() }));
vi.mock("@/lib/data/transitions", () => ({ transitionApplicationAsSystem: vi.fn() }));

import { ingestResumeDocument } from "./ingest-resume";
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
  saveResumeScore,
} from "@/lib/data/candidates";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import { extractResumeData, scoreResumeAgainstCriteria } from "@/lib/services/openai";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const mockUpload = vi.mocked(uploadResumeToStorage);
const mockUpsert = vi.mocked(upsertCandidate);
const mockCreateApp = vi.mocked(createApplicationIfNotExists);
const mockAudit = vi.mocked(logAiAudit);
const mockSaveScore = vi.mocked(saveResumeScore);
const mockFetchConfig = vi.mocked(fetchCampaignScoringConfig);
const mockFetchRubric = vi.mocked(fetchActiveRubricVersion);
const mockExtractMarkdown = vi.mocked(extractMarkdownWithMarker);
const mockExtractData = vi.mocked(extractResumeData);
const mockScore = vi.mocked(scoreResumeAgainstCriteria);
const mockEvaluate = vi.mocked(evaluateResumeScoringOutcome);
const mockTransition = vi.mocked(transitionApplicationAsSystem);

function parsedCv(over: Partial<ParsedResumeData> = {}): ParsedResumeData {
  return {
    document_type: "cv",
    first_name: "Alice",
    last_name: "Smith",
    headline: null,
    summary: null,
    email: "alice@example.com",
    phone: null,
    location: null,
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
    skills: [],
    languages: [],
    interests: [],
    certifications: [],
    experience: [],
    education: [],
    ...over,
  };
}

const DB = {} as never;

function args(over: Partial<Parameters<typeof ingestResumeDocument>[0]> = {}) {
  return {
    db: DB,
    campaignId: "camp-1",
    ownerUserId: "user-1",
    filename: "alice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("pdf"),
    source: "apply_form",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockExtractMarkdown.mockResolvedValue({ markdown: "Alice resume", pageCount: 1, parseQualityScore: 0.9, costBreakdown: null });
  mockExtractData.mockResolvedValue(parsedCv());
  mockUpload.mockResolvedValue("camp-1/alice.pdf");
  mockUpsert.mockResolvedValue("cand-1");
  mockCreateApp.mockResolvedValue("app-1");
  mockAudit.mockResolvedValue(undefined as never);

  mockFetchConfig.mockResolvedValue({
    id: "camp-1",
    description: "Backend engineer",
    automation_mode: "fully_auto",
    screening_threshold: 70,
    screening_criteria: [{ id: "d1", label: "React", weight: 1, is_mandatory: true, min_score: 50 }],
  });
  mockFetchRubric.mockResolvedValue(1);
  mockScore.mockResolvedValue({
    result: { overall_score: 80, tier: "strong", rationale: "Good", factors: [{ name: "React", weight: 1, score: 80 }] },
    rawOutput: "{}",
    model: "gpt-4o-mini",
    promptVersion: "v1",
  });
  mockEvaluate.mockReturnValue({ toState: "screening_approved", rationale: "passed" });
  mockSaveScore.mockResolvedValue(undefined);
  mockTransition.mockResolvedValue(undefined);
});

describe("ingestResumeDocument", () => {
  it("ingests a CV, scores it, and advances via the system transition", async () => {
    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com" }),
      DB,
    );
    expect(mockTransition).toHaveBeenCalledWith("app-1", "screening_approved", "passed");
  });

  it("rejects an unreadable document without uploading or creating anything", async () => {
    mockExtractMarkdown.mockRejectedValue(new Error("marker down"));

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "rejected", reason: "unreadable" });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreateApp).not.toHaveBeenCalled();
  });

  it("rejects a non-CV document (e.g. a motivation letter)", async () => {
    mockExtractData.mockResolvedValue(parsedCv({ document_type: "motivation_letter" }));

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "rejected", reason: "not_a_cv" });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a CV with no extractable email instead of inventing one", async () => {
    mockExtractData.mockResolvedValue(parsedCv({ email: null }));

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "rejected", reason: "no_email" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("ingests without scoring when the campaign has no criteria", async () => {
    mockFetchConfig.mockResolvedValue(null);

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockScore).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("still reports ingested when scoring fails (best-effort, non-blocking)", async () => {
    mockScore.mockRejectedValue(new Error("openai down"));

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockTransition).not.toHaveBeenCalled();
  });
});
