import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchOverdue, mockMarkExpired, mockTransitionSystem } = vi.hoisted(() => ({
  mockFetchOverdue: vi.fn(),
  mockMarkExpired: vi.fn(),
  mockTransitionSystem: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __brand: "admin-client" }),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  fetchOverdueInterviewSessions: mockFetchOverdue,
  markInterviewExpired: mockMarkExpired,
}));
vi.mock("@/lib/data/transitions", () => ({
  transitionApplicationAsSystem: mockTransitionSystem,
}));

// The pure rule stays real — which sessions are abandoned is the decision under
// test, not something to stub out.
import { sweepExpiredInterviews } from "./expiry-sweep";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function minutesAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60 * 1000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransitionSystem.mockResolvedValue(undefined);
  mockMarkExpired.mockResolvedValue(undefined);
  mockFetchOverdue.mockResolvedValue([]);
});

describe("sweepExpiredInterviews", () => {
  it("moves an unopened, overdue invitation to interview_expired as the system", async () => {
    mockFetchOverdue.mockResolvedValue([
      { application_id: "app-1", status: "invited", expires_at: minutesAgo(60), started_at: null },
    ]);

    const result = await sweepExpiredInterviews(NOW);

    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-1",
      "interview_expired",
      expect.any(String),
      expect.objectContaining({ code: "EXPIRED" }),
    );
    expect(mockMarkExpired).toHaveBeenCalledWith("app-1", expect.anything());
    expect(result).toEqual({ scanned: 1, skipped: 0, expired: 1, failed: 0 });
  });

  /**
   * The sweep must not close a call that is still in progress. Without this the
   * fix for a stuck no-show would itself destroy live interviews.
   */
  it("skips a call still running when its deadline passed", async () => {
    mockFetchOverdue.mockResolvedValue([
      {
        application_id: "app-live",
        status: "in_progress",
        expires_at: minutesAgo(2),
        started_at: minutesAgo(2),
      },
    ]);

    const result = await sweepExpiredInterviews(NOW);

    expect(mockTransitionSystem).not.toHaveBeenCalled();
    expect(mockMarkExpired).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, skipped: 1, expired: 0, failed: 0 });
  });

  it("expires an abandoned session that was started but never submitted", async () => {
    mockFetchOverdue.mockResolvedValue([
      {
        application_id: "app-gone",
        status: "in_progress",
        expires_at: minutesAgo(600),
        started_at: minutesAgo(600),
      },
    ]);

    const result = await sweepExpiredInterviews(NOW);

    expect(mockTransitionSystem).toHaveBeenCalledWith(
      "app-gone",
      "interview_expired",
      expect.any(String),
      expect.anything(),
    );
    expect(result.expired).toBe(1);
  });

  it("keeps going when one application fails, so a bad row can't strand the rest", async () => {
    mockFetchOverdue.mockResolvedValue([
      { application_id: "app-1", status: "invited", expires_at: minutesAgo(60), started_at: null },
      { application_id: "app-2", status: "invited", expires_at: minutesAgo(60), started_at: null },
    ]);
    mockTransitionSystem.mockRejectedValueOnce(new Error("Illegal transition"));

    const result = await sweepExpiredInterviews(NOW);

    expect(result).toEqual({ scanned: 2, skipped: 0, expired: 1, failed: 1 });
    expect(mockTransitionSystem).toHaveBeenCalledTimes(2);
  });

  it("transitions the application before flipping the session row", async () => {
    // Application state is what the pipeline reads; the reverse order would
    // strand the application if the second write failed.
    const order: string[] = [];
    mockTransitionSystem.mockImplementation(async () => void order.push("transition"));
    mockMarkExpired.mockImplementation(async () => void order.push("session"));
    mockFetchOverdue.mockResolvedValue([
      { application_id: "app-1", status: "invited", expires_at: minutesAgo(60), started_at: null },
    ]);

    await sweepExpiredInterviews(NOW);

    expect(order).toEqual(["transition", "session"]);
  });

  it("reports an empty sweep without touching anything", async () => {
    const result = await sweepExpiredInterviews(NOW);

    expect(result).toEqual({ scanned: 0, skipped: 0, expired: 0, failed: 0 });
    expect(mockTransitionSystem).not.toHaveBeenCalled();
  });
});
