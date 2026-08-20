import { afterEach, describe, expect, it } from "vitest";
import { isTeamReviewersEnabled } from "./flags";

const VAR = "NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS";

afterEach(() => {
  delete process.env[VAR];
});

describe("isTeamReviewersEnabled", () => {
  /**
   * The whole point of the flag: a default install must not show a feature that
   * writes placeholder identities into a table nothing reads.
   */
  it("is off when nothing is configured", () => {
    delete process.env[VAR];

    expect(isTeamReviewersEnabled()).toBe(false);
  });

  it("is on for the exact string true", () => {
    process.env[VAR] = "true";

    expect(isTeamReviewersEnabled()).toBe(true);
  });

  /**
   * A mistyped flag must land on the safe side. "1", "yes" and "TRUE" all read
   * as an operator intending to enable it — and all of them stay off, so the
   * intent has to be spelled correctly to take effect.
   */
  it.each(["", "1", "yes", "TRUE", "on", "false"])(
    "stays off for %o",
    (value) => {
      process.env[VAR] = value;

      expect(isTeamReviewersEnabled()).toBe(false);
    },
  );
});
