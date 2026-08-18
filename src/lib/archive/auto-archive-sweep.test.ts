import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchArchivable, mockTransitionSystem } = vi.hoisted(() => ({
  mockFetchArchivable: vi.fn(),
  mockTransitionSystem: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __brand: "admin-client" }),
}));
vi.mock("@/lib/data/candidates", () => ({
  fetchArchivableApplications: mockFetchArchivable,
}));
vi.mock("@/lib/data/transitions", () => ({
  transitionApplicationAsSystem: mockTransitionSystem,
}));

// The pure rule stays real — which rows are due is the decision under test.
import { sweepAutoArchive } from "./auto-archive-sweep";

const NOW = new Date("2026-08-19T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function row(overrides = {}) {
  return {
    application_id: "app-1",
    status: "screening_expired",
    entered_at: daysAgo(40),
    auto_archive_after_days: 30,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransitionSystem.mockResolvedValue(undefined);
  mockFetchArchivable.mockResolvedValue([]);
});

describe("sweepAutoArchive", () => {
  it("archives a non-responsive application past its window, as the system", async () => {
    mockFetchArchivable.mockResolvedValue([row()]);

    const result = await sweepAutoArchive(NOW);

    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-1",
      "archived",
      expect.any(String),
      expect.objectContaining({ code: "EXPIRED" }),
    );
    expect(result).toEqual({ scanned: 1, skipped: 0, archived: 1, failed: 0 });
  });

  it("leaves an application still inside its window", async () => {
    mockFetchArchivable.mockResolvedValue([row({ entered_at: daysAgo(10) })]);

    const result = await sweepAutoArchive(NOW);

    expect(mockTransitionSystem).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, skipped: 1, archived: 0, failed: 0 });
  });

  /**
   * `archived` requires a disposition, and "archived after 30 days" alone would
   * lose the difference between never opening a screening link and no-showing
   * an interview — two facts a recruiter counts separately.
   */
  it("carries forward WHY the candidate stopped responding", async () => {
    mockFetchArchivable.mockResolvedValue([
      row({ application_id: "app-ns", status: "interview_no_show" }),
    ]);

    await sweepAutoArchive(NOW);

    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-ns",
      "archived",
      expect.any(String),
      expect.objectContaining({ code: "NO_SHOW" }),
    );
  });

  it("keeps going when one application fails", async () => {
    mockFetchArchivable.mockResolvedValue([
      row({ application_id: "app-1" }),
      row({ application_id: "app-2" }),
    ]);
    mockTransitionSystem.mockRejectedValueOnce(new Error("Illegal transition"));

    const result = await sweepAutoArchive(NOW);

    expect(result).toEqual({ scanned: 2, skipped: 0, archived: 1, failed: 1 });
  });

  it("archives nothing when no campaign has opted in", async () => {
    // The data layer excludes NULL windows, so an empty set is the normal
    // steady state until a recruiter configures one.
    const result = await sweepAutoArchive(NOW);

    expect(result).toEqual({ scanned: 0, skipped: 0, archived: 0, failed: 0 });
    expect(mockTransitionSystem).not.toHaveBeenCalled();
  });
});
