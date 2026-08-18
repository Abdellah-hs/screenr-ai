import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SECRET = "a-test-secret-that-is-at-least-32-chars-long";
const originalSecret = process.env.SCREENING_TOKEN_SECRET;

beforeAll(() => {
  process.env.SCREENING_TOKEN_SECRET = SECRET;
});

afterAll(() => {
  process.env.SCREENING_TOKEN_SECRET = originalSecret;
  vi.useRealTimers();
});

import {
  peekResponseToken,
  signResponseToken,
  verifyResponseToken,
} from "./screening-token";

const APP_ID = "11111111-2222-3333-4444-555555555555";

/** Mint a token that expired `msAgo` milliseconds ago. */
function expiredToken(msAgo: number): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.now() - msAgo - 1000));
  const token = signResponseToken(APP_ID, 1000);
  vi.useRealTimers();
  return token;
}

describe("verifyResponseToken", () => {
  it("returns the application id for a live token", () => {
    const token = signResponseToken(APP_ID, 60_000);

    expect(verifyResponseToken(token).application_id).toBe(APP_ID);
  });

  it("rejects a token whose deadline has passed", () => {
    expect(() => verifyResponseToken(expiredToken(60_000))).toThrow(/expired/i);
  });

  it("rejects a tampered payload", () => {
    const token = signResponseToken(APP_ID, 60_000);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ aid: "other", exp: Date.now() + 60_000, n: "x" }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${sig}`;

    expect(() => verifyResponseToken(forged)).toThrow(/not valid/i);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyResponseToken("garbage")).toThrow(/not valid/i);
  });
});

/**
 * `peek` exists so the expiry paths can learn WHOSE link lapsed. Before it, the
 * deadline lived in the token, so the only code that knew a link was dead also
 * refused to say which application it belonged to — which is why an invited
 * no-show sat in `interview_invited` forever.
 */
describe("peekResponseToken", () => {
  it("recovers the application id from an authentic but lapsed link", () => {
    const result = peekResponseToken(expiredToken(60_000));

    expect(result.application_id).toBe(APP_ID);
    expect(result.expired).toBe(true);
  });

  it("reports a live token as not expired", () => {
    const result = peekResponseToken(signResponseToken(APP_ID, 60_000));

    expect(result.application_id).toBe(APP_ID);
    expect(result.expired).toBe(false);
  });

  it("still refuses a forged signature — expiry is relaxed, authenticity is not", () => {
    // The whole safety of the peek rests on this: relaxing the deadline must
    // not relax who is allowed to name an application.
    const token = signResponseToken(APP_ID, 60_000);
    const [payload] = token.split(".");

    expect(() => peekResponseToken(`${payload}.forgedsignature`)).toThrow(/not valid/i);
  });

  it("still refuses a malformed token", () => {
    expect(() => peekResponseToken("nope")).toThrow(/not valid/i);
  });
});
