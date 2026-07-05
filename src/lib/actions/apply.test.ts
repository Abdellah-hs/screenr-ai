import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: () => null })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/data/campaigns", () => ({ fetchCampaignBySlug: vi.fn() }));
vi.mock("@/lib/data/integrations", () => ({ fetchGmailConnection: vi.fn() }));
vi.mock("@/lib/resume-ingest/mime", () => ({ isSupportedResumeMimeType: vi.fn() }));
vi.mock("@/lib/resume-ingest/ingest-resume", () => ({ ingestResumeDocument: vi.fn() }));
vi.mock("@/lib/services/gmail", () => ({ createGmailClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));

import { loadApplyContext, submitApplication } from "./apply";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchCampaignBySlug, type CampaignBySlug } from "@/lib/data/campaigns";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { isSupportedResumeMimeType } from "@/lib/resume-ingest/mime";
import { ingestResumeDocument } from "@/lib/resume-ingest/ingest-resume";
import { sendEmail } from "@/lib/services/email";

const mockRateLimit = vi.mocked(checkRateLimit);
const mockFetchBySlug = vi.mocked(fetchCampaignBySlug);
const mockFetchConnection = vi.mocked(fetchGmailConnection);
const mockSupportedMime = vi.mocked(isSupportedResumeMimeType);
const mockIngest = vi.mocked(ingestResumeDocument);
const mockSendEmail = vi.mocked(sendEmail);

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

function form(
  over: {
    slug?: string;
    file?: File | null;
    first_name?: string;
    last_name?: string;
    email?: string;
  } = {},
): FormData {
  const data = new FormData();
  data.set("slug", over.slug ?? "backend-engineer");
  data.set("first_name", over.first_name ?? "Alice");
  data.set("last_name", over.last_name ?? "Smith");
  data.set("email", over.email ?? "alice@example.com");
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
  mockFetchConnection.mockResolvedValue({
    user_id: "user-1",
    email: "recruiter@matious.com",
    refresh_token: "tok",
    scope: null,
    connected_at: "2026-07-01T00:00:00Z",
    id: "conn-1",
    created_at: "2026-07-01T00:00:00Z",
  } as never);
  mockSendEmail.mockResolvedValue("msg-1");
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

  it("passes the self-declared identity through to the ingest pipeline", async () => {
    await submitApplication(
      form({ first_name: " Alice ", last_name: "Smith", email: "Alice@Example.COM" }),
    );

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        applicant: { first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
      }),
    );
  });

  it("rejects a missing first name without ingesting", async () => {
    await expect(submitApplication(form({ first_name: "  " }))).rejects.toThrow(
      /first name/i,
    );
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects a missing last name without ingesting", async () => {
    await expect(submitApplication(form({ last_name: "" }))).rejects.toThrow(/last name/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects a malformed email without ingesting", async () => {
    await expect(submitApplication(form({ email: "nope" }))).rejects.toThrow(
      /valid email/i,
    );
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("sends a confirmation email to the applicant after a successful ingest", async () => {
    await submitApplication(form());

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "alice@example.com",
        subject: expect.stringContaining("Backend Engineer"),
      }),
    );
  });

  it("still returns ok when the confirmation email fails (best-effort)", async () => {
    mockSendEmail.mockRejectedValue(new Error("gmail down"));

    const result = await submitApplication(form());

    expect(result).toEqual({ ok: true });
  });

  it("skips the confirmation email when the owner has no Gmail connected", async () => {
    mockFetchConnection.mockResolvedValue(null);

    const result = await submitApplication(form());

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not send a confirmation email when the ingest is rejected", async () => {
    mockIngest.mockResolvedValue({ outcome: "rejected", reason: "not_a_cv" });

    await expect(submitApplication(form())).rejects.toThrow();
    expect(mockSendEmail).not.toHaveBeenCalled();
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
