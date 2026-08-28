import { describe, it, expect, vi, beforeEach } from "vitest";

// Captures `after()` callbacks WITHOUT running them, so tests control when
// the deferred pipeline executes — mirroring production, where the response
// returns first.
const { afterQueue } = vi.hoisted(() => ({
  afterQueue: [] as Array<() => unknown>,
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterQueue.push(fn);
  },
}));

async function flushAfter(): Promise<void> {
  for (const fn of afterQueue.splice(0)) await fn();
}

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: () => null })),
}));
vi.mock("@/lib/http/origin", () => ({
  getRequestOrigin: () => Promise.resolve("https://hire.example.com"),
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
    accepting_applications: true,
    deadline: null,
    deadline_enforced: false,
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
  afterQueue.length = 0;
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
  it("returns ok immediately — the ingest pipeline runs only after the response", async () => {
    const result = await submitApplication(form());

    expect(result).toEqual({ ok: true });
    expect(mockIngest).not.toHaveBeenCalled();

    await flushAfter();

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
    await flushAfter();

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        applicant: {
          first_name: "Alice",
          last_name: "Smith",
          email: "alice@example.com",
          linkedin_url: null,
          portfolio_url: null,
        },
      }),
    );
  });

  it("normalizes optional profile links before handing them to the pipeline", async () => {
    const data = form();
    data.set("linkedin", "in/alice-smith");
    data.set("website", "alice.dev");

    await submitApplication(data);
    await flushAfter();

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        applicant: expect.objectContaining({
          linkedin_url: "https://www.linkedin.com/in/alice-smith",
          portfolio_url: "https://alice.dev",
        }),
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
    await flushAfter();

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "alice@example.com",
        subject: expect.stringContaining("Backend Engineer"),
      }),
    );
  });

  it("still completes the deferred pipeline when the confirmation email fails (best-effort)", async () => {
    mockSendEmail.mockRejectedValue(new Error("gmail down"));

    const result = await submitApplication(form());

    expect(result).toEqual({ ok: true });
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("skips the confirmation email when the owner has no Gmail connected", async () => {
    mockFetchConnection.mockResolvedValue(null);

    const result = await submitApplication(form());
    await flushAfter();

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("emails an actionable problem notice instead of a confirmation when the ingest is rejected", async () => {
    mockIngest.mockResolvedValue({ outcome: "rejected", reason: "not_a_cv" });

    const result = await submitApplication(form());
    await flushAfter();

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0][1];
    expect(sent.to).toBe("alice@example.com");
    expect(sent.subject.toLowerCase()).toContain("action needed");
    expect(sent.text).toContain("doesn't look like a CV");
    expect(sent.text).toContain("https://hire.example.com/apply/backend-engineer");
  });

  it("sends the ordinary receipt when the failure was ours, not their CV", async () => {
    // They ARE filed — `processing_failed`, with the CV stored and a retry in
    // the recruiter's hands. Asking them to apply again would be asking a
    // candidate to fix our outage, and would file them twice.
    mockIngest.mockResolvedValue({ outcome: "processing_failed", applicationId: "app-1" });

    const result = await submitApplication(form());
    await flushAfter();

    expect(result).toEqual({ ok: true });
    const sent = mockSendEmail.mock.calls[0][1];
    expect(sent.subject.toLowerCase()).toContain("received your application");
    expect(sent.text).not.toContain("try applying again");
  });

  it("emails a retry notice when the pipeline itself blows up mid-flight", async () => {
    mockIngest.mockRejectedValue(new Error("marker down"));

    const result = await submitApplication(form());
    await flushAfter();

    expect(result).toEqual({ ok: true });
    const sent = mockSendEmail.mock.calls[0][1];
    expect(sent.subject.toLowerCase()).toContain("action needed");
    expect(sent.text).toContain("try applying again");
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

  it("refuses to ingest into an active campaign with intake switched off", async () => {
    mockFetchBySlug.mockResolvedValue(
      campaign({ status: "active", accepting_applications: false }),
    );

    await expect(submitApplication(form())).rejects.toThrow(/isn't accepting applications/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("refuses to ingest when an enforced deadline has already passed", async () => {
    mockFetchBySlug.mockResolvedValue(
      campaign({ status: "active", deadline: "2020-01-01T00:00:00.000Z", deadline_enforced: true }),
    );

    await expect(submitApplication(form())).rejects.toThrow(/isn't accepting applications/i);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("still ingests when a passed deadline is not enforced", async () => {
    mockFetchBySlug.mockResolvedValue(
      campaign({ status: "active", deadline: "2020-01-01T00:00:00.000Z", deadline_enforced: false }),
    );

    const result = await submitApplication(form());
    await flushAfter();

    expect(result).toEqual({ ok: true });
    expect(mockIngest).toHaveBeenCalled();
  });

  it("carries the specific rejection reason in the problem email (no email on the CV)", async () => {
    mockIngest.mockResolvedValue({ outcome: "rejected", reason: "no_email" });

    await submitApplication(form());
    await flushAfter();

    const sent = mockSendEmail.mock.calls[0][1];
    expect(sent.text).toContain("couldn't find an email address");
  });
});
