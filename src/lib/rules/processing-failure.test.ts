import { describe, expect, it } from "vitest";

import {
  isRecoverableProcessingFailure,
  processingFailureOrigin,
} from "./processing-failure";

describe("isRecoverableProcessingFailure", () => {
  it("allows an ingest that broke before anything was established", () => {
    expect(
      isRecoverableProcessingFailure({ status: "processing_failed", failedFrom: "new" }),
    ).toBe(true);
  });

  it.each(["screening_completed", "interview_completed"] as const)(
    "refuses a score that failed at %s — re-reading the CV would discard that stage",
    (failedFrom) => {
      expect(isRecoverableProcessingFailure({ status: "processing_failed", failedFrom })).toBe(
        false,
      );
    },
  );

  it("refuses when no failure is recorded at all", () => {
    expect(
      isRecoverableProcessingFailure({ status: "processing_failed", failedFrom: null }),
    ).toBe(false);
  });

  it("refuses an application that is not currently failed", () => {
    expect(isRecoverableProcessingFailure({ status: "new", failedFrom: "new" })).toBe(false);
  });
});

describe("processingFailureOrigin", () => {
  const entry = (
    fromState: "new" | "screening_completed" | null,
    toState: "processing_failed" | "new" | "screening_scored",
    at: string,
  ) => ({ fromState, toState, at });

  it("reads the state the application failed from", () => {
    expect(
      processingFailureOrigin([
        entry(null, "new", "2026-08-25T10:00:00.000Z"),
        entry("new", "processing_failed", "2026-08-25T10:01:00.000Z"),
      ]),
    ).toBe("new");
  });

  it("takes the LATEST failure — an application can fail, be repaired, and fail again", () => {
    // Repaired from an ingest failure, screened, then the screening score
    // broke. Reading the first entry would offer to re-read the CV and throw
    // the screening away.
    expect(
      processingFailureOrigin([
        entry("new", "processing_failed", "2026-08-25T10:00:00.000Z"),
        entry("screening_completed", "processing_failed", "2026-08-27T09:00:00.000Z"),
      ]),
    ).toBe("screening_completed");
  });

  it("does not depend on the caller having sorted the entries", () => {
    expect(
      processingFailureOrigin([
        entry("screening_completed", "processing_failed", "2026-08-27T09:00:00.000Z"),
        entry("new", "processing_failed", "2026-08-25T10:00:00.000Z"),
      ]),
    ).toBe("screening_completed");
  });

  it("returns null when nothing ever failed", () => {
    expect(
      processingFailureOrigin([entry(null, "new", "2026-08-25T10:00:00.000Z")]),
    ).toBeNull();
  });
});
