import { describe, expect, it } from "vitest";
import {
  archiveDisposition,
  isAutoArchivable,
  resolveRestoreTarget,
  shouldAutoArchive,
  AUTO_ARCHIVABLE_STATES,
} from "./auto-archive";

const NOW = new Date("2026-08-19T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function candidate(overrides = {}) {
  return {
    status: "screening_expired",
    entered_at: daysAgo(40),
    auto_archive_after_days: 30,
    ...overrides,
  };
}

describe("shouldAutoArchive", () => {
  it("archives a non-responsive application past the window", () => {
    expect(shouldAutoArchive(candidate(), NOW)).toBe(true);
  });

  it("leaves an application still inside the window", () => {
    expect(shouldAutoArchive(candidate({ entered_at: daysAgo(29) }), NOW)).toBe(false);
  });

  it("archives exactly on the boundary", () => {
    expect(shouldAutoArchive(candidate({ entered_at: daysAgo(30) }), NOW)).toBe(true);
  });

  /**
   * Null is the default for every existing campaign, so this is what stops the
   * sweep archiving anyone the moment it deploys.
   */
  it("never archives when the campaign has not opted in", () => {
    expect(
      shouldAutoArchive(candidate({ auto_archive_after_days: null }), NOW),
    ).toBe(false);
  });

  it("never archives on a missing or unparseable timestamp", () => {
    // We cannot tell how long it has waited; hiding a candidate on a guess is
    // worse than waiting another day.
    expect(shouldAutoArchive(candidate({ entered_at: null }), NOW)).toBe(false);
    expect(shouldAutoArchive(candidate({ entered_at: "not-a-date" }), NOW)).toBe(false);
  });

  it("never archives a state that is not a non-responsive dead-end", () => {
    for (const status of ["screening_sent", "interview_invited", "manager_review"]) {
      expect(shouldAutoArchive(candidate({ status }), NOW)).toBe(false);
    }
  });

  /**
   * `rejected` and `hired` CAN be archived by hand, but a decided outcome
   * should leave the pipeline when a person says so, not on a timer.
   */
  it("never sweeps a decided outcome", () => {
    for (const status of ["rejected", "hired"]) {
      expect(shouldAutoArchive(candidate({ status }), NOW)).toBe(false);
    }
  });

  it("archives every non-responsive failure state", () => {
    for (const status of AUTO_ARCHIVABLE_STATES) {
      expect(shouldAutoArchive(candidate({ status }), NOW)).toBe(true);
    }
  });
});

describe("isAutoArchivable", () => {
  it("accepts the four non-responsive dead-ends and nothing else", () => {
    expect(AUTO_ARCHIVABLE_STATES).toHaveLength(4);
    expect(isAutoArchivable("screening_expired")).toBe(true);
    expect(isAutoArchivable("hired")).toBe(false);
  });
});

describe("archiveDisposition", () => {
  it("carries forward WHY the candidate stopped being active", () => {
    // "archived after 30 days" alone loses the difference between someone who
    // never opened their link and someone who no-showed an interview.
    expect(archiveDisposition("interview_no_show", 30).code).toBe("NO_SHOW");
    expect(archiveDisposition("screening_expired", 30).code).toBe("EXPIRED");
  });

  it("names the window in the description, singular when it is one day", () => {
    expect(archiveDisposition("screening_expired", 1).description).toContain("1 day");
    expect(archiveDisposition("screening_expired", 30).description).toContain("30 days");
  });
});

describe("resolveRestoreTarget", () => {
  it("restores the state the application actually came from", () => {
    expect(resolveRestoreTarget("interview_expired")).toBe("interview_expired");
  });

  it("refuses a state that archived cannot legally return to", () => {
    // Otherwise un-archive becomes a shortcut into a stage the candidate never
    // reached, and the transitions log would show it as though they had.
    expect(resolveRestoreTarget("manager_review")).toBeNull();
    expect(resolveRestoreTarget("screening_sent")).toBeNull();
  });

  it("refuses a missing origin rather than guessing", () => {
    expect(resolveRestoreTarget(null)).toBeNull();
  });
});
