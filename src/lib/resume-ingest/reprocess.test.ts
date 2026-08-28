import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedResumeData } from "@/lib/services/openai";

vi.mock("@/lib/data/candidates", () => ({
  downloadResumeFromStorage: vi.fn(),
  saveReprocessedResume: vi.fn(),
  logAiAudit: vi.fn(),
  // Imported by ingest-resume, which this module pulls `scoreAndAdvance` from.
  uploadResumeToStorage: vi.fn(),
  upsertCandidate: vi.fn(),
  createApplicationIfNotExists: vi.fn(),
}));
vi.mock("@/lib/services/marker", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/marker")>(
    "@/lib/services/marker",
  );
  return { ...actual, extractMarkdownWithMarker: vi.fn() };
});
vi.mock("@/lib/services/openai", () => ({ extractResumeData: vi.fn() }));
vi.mock("@/lib/resume-ingest/score-resume", () => ({ evaluateApplicationResume: vi.fn() }));
vi.mock("@/lib/rules/resume-scoring", () => ({ evaluateResumeScoringOutcome: vi.fn() }));
vi.mock("@/lib/data/transitions", () => ({ transitionApplicationAsSystem: vi.fn() }));

import { reprocessFailedApplication } from "./reprocess";
import {
  downloadResumeFromStorage,
  saveReprocessedResume,
  logAiAudit,
  upsertCandidate,
  createApplicationIfNotExists,
} from "@/lib/data/candidates";
import { extractMarkdownWithMarker, MarkerError } from "@/lib/services/marker";
import { extractResumeData } from "@/lib/services/openai";
import { evaluateApplicationResume } from "@/lib/resume-ingest/score-resume";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const mockDownload = vi.mocked(downloadResumeFromStorage);
const mockSave = vi.mocked(saveReprocessedResume);
const mockAudit = vi.mocked(logAiAudit);
const mockUpsert = vi.mocked(upsertCandidate);
const mockCreateApp = vi.mocked(createApplicationIfNotExists);
const mockExtractMarkdown = vi.mocked(extractMarkdownWithMarker);
const mockExtractData = vi.mocked(extractResumeData);
const mockEvaluateResume = vi.mocked(evaluateApplicationResume);
const mockDecide = vi.mocked(evaluateResumeScoringOutcome);
const mockTransition = vi.mocked(transitionApplicationAsSystem);

function parsedCv(over: Partial<ParsedResumeData> = {}): ParsedResumeData {
  return {
    document_type: "cv",
    first_name: "Alice",
    last_name: "Smith",
    headline: "Backend engineer",
    summary: null,
    email: "alice@cv.example.com",
    phone: "+212600000000",
    location: "Casablanca",
    linkedin_url: null,
    github_url: "https://github.com/alice",
    portfolio_url: null,
    skills: ["Go"],
    languages: [],
    interests: [],
    certifications: [],
    experience: [],
    education: [],
    ...over,
  };
}

const DB = {} as never;

function args(over: Partial<Parameters<typeof reprocessFailedApplication>[0]> = {}) {
  return {
    db: DB,
    applicationId: "app-1",
    campaignId: "camp-1",
    candidateId: "cand-1",
    ownerUserId: "user-1",
    resumeUrl: "camp-1/uuid-alice.pdf",
    applicant: {
      first_name: "Alice",
      last_name: "Smith",
      email: "alice@form.example.com",
      linkedin_url: null,
      portfolio_url: null,
    },
    candidateContact: {
      phone: null,
      location: null,
      linkedin_url: null,
      github_url: null,
      portfolio_url: null,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDownload.mockResolvedValue(Buffer.from("pdf"));
  mockExtractMarkdown.mockResolvedValue({
    markdown: "Alice resume",
    pageCount: 1,
    parseQualityScore: 0.9,
    costBreakdown: null,
  });
  mockExtractData.mockResolvedValue(parsedCv());
  mockEvaluateResume.mockResolvedValue(null);
});

describe("reprocessFailedApplication", () => {
  it("puts a recovered application back into new so the scoring rule still decides", async () => {
    const result = await reprocessFailedApplication(args());

    expect(result).toEqual({ outcome: "ingested" });
    expect(mockTransition).toHaveBeenCalledWith("app-1", "new", expect.any(String));
  });

  it("never creates a second candidate for a person who already has one", async () => {
    // `upsertCandidate` always INSERTS and flags a duplicate rather than
    // merging, so a retry built on the ingest pipeline would fill the
    // duplicate queue with the consequences of our own outage.
    await reprocessFailedApplication(args());

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockCreateApp).not.toHaveBeenCalled();
  });

  it("keeps the self-declared identity over what the CV says", async () => {
    await reprocessFailedApplication(args());

    expect(mockSave.mock.calls[0][0].parsedData).toMatchObject({
      first_name: "Alice",
      last_name: "Smith",
      email: "alice@form.example.com",
    });
  });

  it("fills blank contact fields from the CV", async () => {
    await reprocessFailedApplication(args());

    expect(mockSave.mock.calls[0][0].candidate).toEqual({
      phone: "+212600000000",
      location: "Casablanca",
      linkedin_url: null,
      github_url: "https://github.com/alice",
      portfolio_url: null,
    });
  });

  it("never blanks a contact field somebody already corrected by hand", async () => {
    const result = await reprocessFailedApplication(
      args({
        candidateContact: {
          phone: "+212611111111",
          location: "Rabat",
          linkedin_url: null,
          github_url: null,
          portfolio_url: null,
        },
      }),
    );

    expect(result).toEqual({ outcome: "ingested" });
    expect(mockSave.mock.calls[0][0].candidate).toMatchObject({
      phone: "+212611111111",
      location: "Rabat",
    });
  });

  it("audits the RAW extraction, so the evidence says what the model returned", async () => {
    await reprocessFailedApplication(args());

    expect(mockAudit.mock.calls[0][0].structuredData).toMatchObject({
      email: "alice@cv.example.com",
    });
  });

  it("scores the recovered CV and lets the rule advance it", async () => {
    mockEvaluateResume.mockResolvedValue({
      result: { ranking_score: 80 },
      config: { resume_threshold: 70 },
    } as never);
    mockDecide.mockReturnValue({
      toState: "screening_approved",
      rationale: "passed",
    } as never);

    await reprocessFailedApplication(args());

    expect(mockTransition).toHaveBeenNthCalledWith(1, "app-1", "new", expect.any(String));
    expect(mockTransition).toHaveBeenNthCalledWith(
      2,
      "app-1",
      "screening_approved",
      "passed",
      undefined,
    );
  });

  it("keeps the recovery when only the scoring step fails", async () => {
    mockEvaluateResume.mockRejectedValue(new Error("scoring exploded"));

    const result = await reprocessFailedApplication(args());

    expect(result).toEqual({ outcome: "ingested" });
    expect(mockTransition).toHaveBeenCalledWith("app-1", "new", expect.any(String));
  });

  it("throws when the failure is STILL ours, leaving the application failed", async () => {
    // Nothing has changed, so nothing should move. The caller says so and
    // offers the button again.
    mockExtractMarkdown.mockRejectedValue(new MarkerError("timeout", "timed out again"));

    await expect(reprocessFailedApplication(args())).rejects.toMatchObject({ kind: "timeout" });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("reports a verdict about the DOCUMENT rather than throwing", async () => {
    mockExtractMarkdown.mockRejectedValue(new MarkerError("conversion_failed", "corrupt"));

    const result = await reprocessFailedApplication(args());

    expect(result).toEqual({ outcome: "rejected", reason: "unreadable" });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("reports a non-CV without moving the application", async () => {
    mockExtractData.mockResolvedValue(parsedCv({ document_type: "motivation_letter" }));

    const result = await reprocessFailedApplication(args());

    expect(result).toEqual({ outcome: "rejected", reason: "not_a_cv" });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("says so plainly when the stored CV has gone missing", async () => {
    mockDownload.mockResolvedValue(null);

    await expect(reprocessFailedApplication(args())).rejects.toThrow(/no longer in storage/);
  });

  it("reads a .docx back as a .docx", async () => {
    await reprocessFailedApplication(args({ resumeUrl: "camp-1/uuid-alice.DOCX" }));

    expect(mockExtractMarkdown).toHaveBeenCalledWith(
      expect.any(Buffer),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
});
