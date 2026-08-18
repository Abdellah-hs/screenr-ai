import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUserId, mockFetchAuditLog } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFetchAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireUserId: mockRequireUserId }));
vi.mock("@/lib/data/audit-log", () => ({ fetchAuditLog: mockFetchAuditLog }));

import { exportAuditLog, getAuditLog } from "./audit-log";

const ENTRY = {
  id: "aud-1",
  created_at: "2026-08-18T10:00:00.000Z",
  stage: "resume_scoring",
  model: "gpt-4o-mini",
  prompt_version: "v1",
  rubric_version: null,
  parsed_score: 82,
  confidence: null,
  rationale: "Strong.",
  raw_output: "{}",
  input_snapshot: {},
  action_taken: null,
  campaign_id: "camp-1",
  campaign_title: "Backend Engineer",
  candidate_id: "cand-1",
  candidate_name: "Ada Lovelace",
  recruiter_action_after: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchAuditLog.mockResolvedValue({ entries: [ENTRY], total: 1 });
});

describe("getAuditLog", () => {
  it("rejects unauthenticated callers before querying", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getAuditLog()).rejects.toThrow("Unauthorized");
    expect(mockFetchAuditLog).not.toHaveBeenCalled();
  });

  it("passes the caller's own id to the query, never one from the client", async () => {
    await getAuditLog({ campaignId: "11111111-2222-4333-8444-555555555555" });

    expect(mockFetchAuditLog).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ campaignId: "11111111-2222-4333-8444-555555555555" }),
      0,
      expect.any(Number),
    );
  });

  it("rejects a malformed campaign id rather than querying with it", async () => {
    await expect(getAuditLog({ campaignId: "not-a-uuid" })).rejects.toThrow();
    expect(mockFetchAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a stage outside the known set", async () => {
    await expect(getAuditLog({ stage: "wat" })).rejects.toThrow();
    expect(mockFetchAuditLog).not.toHaveBeenCalled();
  });

  /**
   * The query filters `created_at < to`. Passing the raw date would mean
   * "to: today" excluded everything logged today — the rows an auditor is most
   * likely to be looking for.
   */
  it("widens the 'to' date to include the whole of that day", async () => {
    await getAuditLog({ from: "2026-08-01", to: "2026-08-18" });

    expect(mockFetchAuditLog).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-19T00:00:00.000Z",
      }),
      0,
      expect.any(Number),
    );
  });

  it("rejects a date that is not YYYY-MM-DD", async () => {
    await expect(getAuditLog({ from: "18/08/2026" })).rejects.toThrow();
  });
});

describe("exportAuditLog", () => {
  it("rejects unauthenticated callers before serializing anything", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(exportAuditLog()).rejects.toThrow("Unauthorized");
    expect(mockFetchAuditLog).not.toHaveBeenCalled();
  });

  /**
   * An export is evidence. Evidence assembled from rows posted back by the
   * browser is not evidence, so the action re-runs the query itself.
   */
  it("re-runs the query rather than trusting anything from the caller", async () => {
    await exportAuditLog({ campaignId: "11111111-2222-4333-8444-555555555555" }, "csv");

    expect(mockFetchAuditLog).toHaveBeenCalledOnce();
  });

  it("returns CSV with a dated filename by default", async () => {
    const result = await exportAuditLog();

    expect(result.mimeType).toBe("text/csv");
    expect(result.filename).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.content).toContain("Ada Lovelace");
  });

  it("returns parseable JSON when asked", async () => {
    const result = await exportAuditLog({}, "json");

    expect(result.mimeType).toBe("application/json");
    expect(() => JSON.parse(result.content)).not.toThrow();
  });

  it("bypasses the page size so the export is the whole selection", async () => {
    await exportAuditLog();

    const [, , page, pageSize] = mockFetchAuditLog.mock.calls[0];
    expect(page).toBe(0);
    expect(pageSize).toBeGreaterThan(1000);
  });

  it("refuses an oversized selection instead of handing over a truncated file", async () => {
    // A silently truncated export looks complete, which is worse than an error.
    mockFetchAuditLog.mockResolvedValue({ entries: [ENTRY], total: 99_999 });

    await expect(exportAuditLog()).rejects.toThrow(/narrow/i);
  });
});
