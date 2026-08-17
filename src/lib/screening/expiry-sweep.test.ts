import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/screening-questions", () => ({
  fetchExpiredSentScreeningAppIds: vi.fn(),
  markScreeningResponseExpiredAsSystem: vi.fn(),
}));

vi.mock("@/lib/data/transitions", () => ({
  transitionApplicationAsSystem: vi.fn(),
}));

import { sweepExpiredScreenings } from "./expiry-sweep";
import {
  fetchExpiredSentScreeningAppIds,
  markScreeningResponseExpiredAsSystem,
} from "@/lib/data/screening-questions";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

const mockFetch = vi.mocked(fetchExpiredSentScreeningAppIds);
const mockMark = vi.mocked(markScreeningResponseExpiredAsSystem);
const mockTransition = vi.mocked(transitionApplicationAsSystem);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockMark.mockResolvedValue(undefined);
  mockTransition.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sweepExpiredScreenings", () => {
  it("expires every overdue application and reports the totals", async () => {
    mockFetch.mockResolvedValue(["app-1", "app-2"]);

    const result = await sweepExpiredScreenings();

    expect(mockTransition).toHaveBeenCalledWith(
      "app-1",
      "screening_expired",
      expect.stringContaining("sweep"),
      { code: "EXPIRED", description: expect.stringContaining("sweep") },
    );
    expect(mockTransition).toHaveBeenCalledWith(
      "app-2",
      "screening_expired",
      expect.any(String),
      expect.objectContaining({ code: "EXPIRED" }),
    );
    expect(mockMark).toHaveBeenCalledWith("app-1");
    expect(mockMark).toHaveBeenCalledWith("app-2");
    expect(result).toEqual({ scanned: 2, expired: 2, failed: 0 });
  });

  it("forwards the injected clock to the deadline query", async () => {
    mockFetch.mockResolvedValue([]);
    const now = new Date("2026-06-22T09:00:00.000Z");

    await sweepExpiredScreenings(now);

    expect(mockFetch).toHaveBeenCalledWith(now);
  });

  it("does no work when nothing is overdue", async () => {
    mockFetch.mockResolvedValue([]);

    const result = await sweepExpiredScreenings();

    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, expired: 0, failed: 0 });
  });

  it("counts a failed application and continues with the rest", async () => {
    mockFetch.mockResolvedValue(["app-1", "app-2", "app-3"]);
    mockTransition.mockImplementation(async (applicationId: string) => {
      if (applicationId === "app-2") throw new Error("illegal transition");
    });

    const result = await sweepExpiredScreenings();

    // The failed app never reaches its row update; the others still complete.
    expect(mockMark).toHaveBeenCalledWith("app-1");
    expect(mockMark).toHaveBeenCalledWith("app-3");
    expect(mockMark).not.toHaveBeenCalledWith("app-2");
    expect(result).toEqual({ scanned: 3, expired: 2, failed: 1 });
  });
});
