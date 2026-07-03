import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: () => null })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/data/campaigns", () => ({ fetchCampaignBySlug: vi.fn() }));
vi.mock("@/lib/resume-ingest/mime", () => ({ isSupportedResumeMimeType: vi.fn() }));
vi.mock("@/lib/resume-ingest/ingest-resume", () => ({ ingestResumeDocument: vi.fn() }));

import { loadApplyContext, submitApplication } from "./apply";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchCampaignBySlug, type CampaignBySlug } from "@/lib/data/campaigns";
import { isSupportedResumeMimeType } from "@/lib/resume-ingest/mime";
import { ingestResumeDocument } from "@/lib/resume-ingest/ingest-resume";

const mockRateLimit = vi.mocked(checkRateLimit);
const mockFetchBySlug = vi.mocked(fetchCampaignBySlug);
const mockSupportedMime = vi.mocked(isSupportedResumeMimeType);
const mockIngest = vi.mocked(ingestResumeDocument);

function campaign(over: Partial<CampaignBySlug> = {}): CampaignBySlug {
  return {
    campaign_id: "camp-1",
    user_id: "user-1",
    title: "Backend Engineer",
    status: "active",
    ...over,
  };
}

function pdf(): File {
  return new File([new Uint8Array([1, 2, 3])], "alice.pdf", { type: "application/pdf" });
}

function form(over: { slug?: string; file?: File | null } = {}): FormData {
  const data = new FormData();
  data.set("slug", over.slug ?? "backend-engineer");
  if (!("file" in over)) data.set("resume", pdf());
  else if (over.file) data.set("resume", over.file);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks wipes call history but not implementations — re-establish the
  // happy-path default so a throwing override (the rate-limit test) can't leak.
  mockRateLimit.mockReturnValue(undefined);
  mockSupportedMime.mockReturnValue(true);
  mockFetchBySlug.mockResolvedValue(campaign());
  mockIngest.mockResolvedValue({ outcome: "ingested", applicationId: "app-1" });
});

describe("loadApplyContext", () => {
  it("returns the title and is_accepting=true for an active campaign", async () => {
    mockFetchBySlug.mockResolvedValue(campaign({ status: "active" }));

    const ctx = await loadApplyContext("backend-engineer");

    expect(ctx).toEqual({ campaign_title: "Backend Engineer", is_accepting: true });
  });

  it("reports is_accepting=false for a campaign that isn't active", async () => {
    mockFetchBySlug.mockResolvedValue(campaign({ status: "paused" }));

    const ctx = await loadApplyContext("backend-engineer");

    expect(ctx.is_accepting).toBe(false);
  });

  it("throws a candidate-facing message when the slug matches no campaign", async () => {
    mockFetchBySlug.mockResolvedValue(null);

    await expect(loadApplyContext("nope")).rejects.toThrow(/couldn't find this opening/i);
  });
});

describe("submitApplication", () => {
  it("ingests a valid CV and returns ok", async () => {
    const result = await submitApplication(form());

    expect(result).toEqual({ ok: true });
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        ownerUserId: "user-1",
        mimeType: "application/pdf",
        source: "apply_form",
      }),
    );
  });

  it("rate-limits before touching the database", async () => {
    mockRateLimit.mockImplementation(() => {
      throw new Error("Rate limit exceeded");
    });

    await expect(submitApplication(form())).rejects.toThrow(/rate limit/i);
    expect(mockFetchBySlug).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects a submission with no file attached", async () => {
    await expect(submitApplication(form({ file: null }))).rejects.toThrow(/attach your CV/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type without ingesting", async () => {
    mockSupportedMime.mockReturnValue(false);
    const txt = new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" });

    await expect(submitApplication(form({ file: txt }))).rejects.toThrow(/PDF or Word/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects a file over the size cap without ingesting", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", {
      type: "application/pdf",
    });

    await expect(submitApplication(form({ file: big }))).rejects.toThrow(/too large/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("throws not-found when the slug matches no campaign", async () => {
    mockFetchBySlug.mockResolvedValue(null);

    await expect(submitApplication(form())).rejects.toThrow(/couldn't find this opening/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("refuses to ingest into a campaign that isn't accepting applications", async () => {
    mockFetchBySlug.mockResolvedValue(campaign({ status: "closed" }));

    await expect(submitApplication(form())).rejects.toThrow(/isn't accepting applications/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("surfaces an ingest rejection as actionable copy (no email on the CV)", async () => {
    mockIngest.mockResolvedValue({ outcome: "rejected", reason: "no_email" });

    await expect(submitApplication(form())).rejects.toThrow(/couldn't find an email address/i);
  });

  it("surfaces a not-a-CV rejection", async () => {
    mockIngest.mockResolvedValue({ outcome: "rejected", reason: "not_a_cv" });

    await expect(submitApplication(form())).rejects.toThrow(/doesn't look like a CV/i);
  });
});
