import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedResumeData } from "@/lib/services/openai";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/data/campaigns", () => ({
  fetchActiveCampaignsForResumeSync: vi.fn(),
  fetchCampaignScoringConfig: vi.fn(),
  fetchActiveRubricVersion: vi.fn(),
}));
vi.mock("@/lib/data/integrations", () => ({ fetchGmailConnection: vi.fn() }));
vi.mock("@/lib/data/candidates", () => ({
  uploadResumeToStorage: vi.fn(),
  upsertCandidate: vi.fn(),
  createApplicationIfNotExists: vi.fn(),
  logAiAudit: vi.fn(),
  saveResumeScore: vi.fn(),
}));
vi.mock("@/lib/services/gmail", () => ({
  createGmailClient: vi.fn(),
  fetchUnreadGmailResumes: vi.fn(),
  getGmailMessage: vi.fn(),
  getGmailAttachmentBuffer: vi.fn(),
  isSupportedResumeMimeType: vi.fn(() => true),
  markGmailMessageAsRead: vi.fn(),
}));
vi.mock("@/lib/services/marker", () => ({ extractMarkdownWithMarker: vi.fn() }));
vi.mock("@/lib/services/openai", () => ({
  extractResumeData: vi.fn(),
  scoreResumeAgainstCriteria: vi.fn(),
}));
vi.mock("@/lib/rules/resume-scoring", () => ({ evaluateResumeScoringOutcome: vi.fn() }));
vi.mock("@/lib/data/transitions", () => ({ transitionApplicationAsSystem: vi.fn() }));

import { sweepResumeSync } from "./sync-sweep";
import {
  fetchActiveCampaignsForResumeSync,
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import { fetchGmailConnection } from "@/lib/data/integrations";
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
} from "@/lib/data/candidates";
import {
  createGmailClient,
  fetchUnreadGmailResumes,
  getGmailMessage,
  getGmailAttachmentBuffer,
  markGmailMessageAsRead,
} from "@/lib/services/gmail";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import { extractResumeData, scoreResumeAgainstCriteria } from "@/lib/services/openai";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const mockFetchCampaigns = vi.mocked(fetchActiveCampaignsForResumeSync);
const mockFetchConnection = vi.mocked(fetchGmailConnection);
const mockCreateGmail = vi.mocked(createGmailClient);
const mockFetchUnread = vi.mocked(fetchUnreadGmailResumes);
const mockGetMessage = vi.mocked(getGmailMessage);
const mockGetAttachment = vi.mocked(getGmailAttachmentBuffer);
const mockMarkRead = vi.mocked(markGmailMessageAsRead);
const mockUpload = vi.mocked(uploadResumeToStorage);
const mockUpsertCandidate = vi.mocked(upsertCandidate);
const mockCreateApp = vi.mocked(createApplicationIfNotExists);
const mockExtractMarkdown = vi.mocked(extractMarkdownWithMarker);
const mockExtractData = vi.mocked(extractResumeData);
const mockScore = vi.mocked(scoreResumeAgainstCriteria);
const mockFetchConfig = vi.mocked(fetchCampaignScoringConfig);
const mockFetchRubric = vi.mocked(fetchActiveRubricVersion);
const mockEvaluate = vi.mocked(evaluateResumeScoringOutcome);
const mockTransition = vi.mocked(transitionApplicationAsSystem);

const CAMPAIGN = {
  campaign_id: "camp-1",
  user_id: "user-1",
  application_email: "careers+eng@company.com",
};

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

beforeEach(() => {
  vi.clearAllMocks();

  mockFetchCampaigns.mockResolvedValue([CAMPAIGN]);
  mockFetchConnection.mockResolvedValue({ refresh_token: "rt-1" } as never);
  mockCreateGmail.mockReturnValue({} as never);
  mockFetchUnread.mockResolvedValue([{ id: "m1" }]);
  mockGetMessage.mockResolvedValue({
    payload: { parts: [{ mimeType: "application/pdf", filename: "alice.pdf", body: { attachmentId: "att-1" } }] },
  } as never);
  mockGetAttachment.mockResolvedValue(Buffer.from("pdf"));
  mockUpload.mockResolvedValue("camp-1/alice.pdf");
  mockExtractMarkdown.mockResolvedValue({ markdown: "Alice resume", pageCount: 1, parseQualityScore: 0.9, costBreakdown: null });
  mockExtractData.mockResolvedValue(parsedCv());
  mockUpsertCandidate.mockResolvedValue("cand-1");
  mockCreateApp.mockResolvedValue("app-1");
  mockMarkRead.mockResolvedValue(undefined as never);

  // Scoring path
  mockFetchConfig.mockResolvedValue({
    id: "camp-1",
    description: "Backend engineer",
    automation_mode: "human_in_loop",
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
  mockEvaluate.mockReturnValue({ toState: "screening_review_pending", rationale: "HITL review" });
  mockTransition.mockResolvedValue(undefined);
});

describe("sweepResumeSync", () => {
  it("ingests a CV, scores it, and advances via the system transition", async () => {
    const result = await sweepResumeSync();

    expect(result).toEqual({ campaignsScanned: 1, ingested: 1, failed: 0 });
    expect(mockUpsertCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com" }),
      expect.anything(),
    );
    expect(mockTransition).toHaveBeenCalledWith("app-1", "screening_review_pending", "HITL review");
    expect(mockMarkRead).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("skips a campaign whose owner hasn't connected Gmail", async () => {
    mockFetchConnection.mockResolvedValue(null);

    const result = await sweepResumeSync();

    expect(result).toEqual({ campaignsScanned: 1, ingested: 0, failed: 0 });
    expect(mockCreateGmail).not.toHaveBeenCalled();
    expect(mockUpsertCandidate).not.toHaveBeenCalled();
  });

  it("skips non-CV documents (e.g. a motivation letter)", async () => {
    mockExtractData.mockResolvedValue(parsedCv({ document_type: "motivation_letter" }));

    const result = await sweepResumeSync();

    expect(result.ingested).toBe(0);
    expect(mockUpsertCandidate).not.toHaveBeenCalled();
    // Still marked read so it isn't reprocessed next sweep.
    expect(mockMarkRead).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("leaves the application unscored (no transition) when the campaign has no criteria", async () => {
    mockFetchConfig.mockResolvedValue(null);

    const result = await sweepResumeSync();

    expect(result.ingested).toBe(1);
    expect(mockScore).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("isolates a per-campaign failure so the rest of the sweep continues", async () => {
    mockFetchCampaigns.mockResolvedValue([
      { ...CAMPAIGN, campaign_id: "bad" },
      { ...CAMPAIGN, campaign_id: "good" },
    ]);
    mockFetchConnection
      .mockRejectedValueOnce(new Error("gmail lookup blew up"))
      .mockResolvedValueOnce({ refresh_token: "rt-2" } as never);
    mockFetchUnread.mockResolvedValue([]); // the good campaign has no new mail

    const result = await sweepResumeSync();

    expect(result).toEqual({ campaignsScanned: 2, ingested: 0, failed: 1 });
  });
});
