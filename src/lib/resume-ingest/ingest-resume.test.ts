import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedResumeData } from "@/lib/services/openai";

vi.mock("@/lib/data/candidates", () => ({
  uploadResumeToStorage: vi.fn(),
  upsertCandidate: vi.fn(),
  createApplicationIfNotExists: vi.fn(),
  logAiAudit: vi.fn(),
}));
vi.mock("@/lib/services/marker", () => ({ extractMarkdownWithMarker: vi.fn() }));
vi.mock("@/lib/services/openai", () => ({ extractResumeData: vi.fn() }));
// The evaluation pipeline has its own tests; here it is a seam, so this file
// stays about ingest — classify, upload, upsert, and advance on the decision.
vi.mock("@/lib/resume-ingest/score-resume", () => ({ evaluateApplicationResume: vi.fn() }));
vi.mock("@/lib/rules/resume-scoring", () => ({ evaluateResumeScoringOutcome: vi.fn() }));
vi.mock("@/lib/data/transitions", () => ({ transitionApplicationAsSystem: vi.fn() }));

import { ingestResumeDocument } from "./ingest-resume";
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
} from "@/lib/data/candidates";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import { extractResumeData } from "@/lib/services/openai";
import { evaluateApplicationResume } from "@/lib/resume-ingest/score-resume";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const mockUpload = vi.mocked(uploadResumeToStorage);
const mockUpsert = vi.mocked(upsertCandidate);
const mockCreateApp = vi.mocked(createApplicationIfNotExists);
const mockAudit = vi.mocked(logAiAudit);
const mockEvaluateResume = vi.mocked(evaluateApplicationResume);
const mockExtractMarkdown = vi.mocked(extractMarkdownWithMarker);
const mockExtractData = vi.mocked(extractResumeData);
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

  mockEvaluateResume.mockResolvedValue({
    result: {
      eligible: true,
      ranking_score: 80,
      tier: "eligible",
      criteria: [],
      failed_must_haves: [],
      validation_warnings: [],
    },
    config: {
      id: "camp-1",
      description: "Backend engineer",
      automation_mode: "fully_auto",
      screening_threshold: 70,
      screening_criteria: [{ id: "d1", label: "React", priority: "must_have" }],
    },
  });
  mockEvaluate.mockReturnValue({ toState: "screening_approved", rationale: "passed" });
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
    expect(mockTransition).toHaveBeenCalledWith(
      "app-1",
      "screening_approved",
      "passed",
      undefined,
    );
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

  it("uses the self-declared applicant identity over the CV-extracted one", async () => {
    const applicant = { first_name: "Alicia", last_name: "Smythe", email: "alicia@form.com" };

    const result = await ingestResumeDocument(args({ applicant }));

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining(applicant),
      DB,
    );
  });

  it("keeps the raw extraction in the AI audit when an applicant identity is supplied", async () => {
    const applicant = { first_name: "Alicia", last_name: "Smythe", email: "alicia@form.com" };

    await ingestResumeDocument(args({ applicant }));

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredData: expect.objectContaining({
          first_name: "Alice",
          last_name: "Smith",
          email: "alice@example.com",
        }),
      }),
      DB,
    );
  });

  it("prefers applicant profile links but falls back to the CV's when left blank", async () => {
    mockExtractData.mockResolvedValue(
      parsedCv({ linkedin_url: "https://www.linkedin.com/in/cv-alice", portfolio_url: "https://cv-alice.dev" }),
    );
    const applicant = {
      first_name: "Alicia",
      last_name: "Smythe",
      email: "alicia@form.com",
      linkedin_url: "https://www.linkedin.com/in/form-alicia",
      portfolio_url: null,
    };

    await ingestResumeDocument(args({ applicant }));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedin_url: "https://www.linkedin.com/in/form-alicia",
        portfolio_url: "https://cv-alice.dev",
      }),
      DB,
    );
  });

  it("ingests a CV with no extractable email when the applicant supplied one", async () => {
    mockExtractData.mockResolvedValue(parsedCv({ email: null }));
    const applicant = { first_name: "Alicia", last_name: "Smythe", email: "alicia@form.com" };

    const result = await ingestResumeDocument(args({ applicant }));

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alicia@form.com" }),
      DB,
    );
  });

  it("ingests without advancing when the campaign has no criteria", async () => {
    mockEvaluateResume.mockResolvedValue(null);

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("still reports ingested when scoring fails (best-effort, non-blocking)", async () => {
    mockEvaluateResume.mockRejectedValue(new Error("openai down"));

    const result = await ingestResumeDocument(args());

    expect(result).toEqual({ outcome: "ingested", applicationId: "app-1" });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("hands the extracted resume text to the evaluator so quotes can be verified", async () => {
    await ingestResumeDocument(args());

    expect(mockEvaluateResume).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-1",
        campaignId: "camp-1",
        rawResumeText: expect.any(String),
      }),
    );
  });
});
