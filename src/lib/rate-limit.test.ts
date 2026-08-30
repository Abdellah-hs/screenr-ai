import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rate-limit";

/**
 * The limiter behind every OpenAI-spending action and the public apply form.
 *
 * It was untested, which for this module is a specific risk rather than a
 * general one: its state is a module-level `Map` that persists for the life of
 * the process, so the failure modes are "the window never slides and a real
 * recruiter is locked out for good" and "the buckets leak until the process
 * dies". Neither shows up in a single call.
 *
 * Every test uses its own bucket name for the same reason — the store is
 * process-global and there is deliberately no reset export, so sharing a name
 * across tests would make them order-dependent.
 */

const LIMIT = { maxRequests: 3, windowMs: 60_000 };

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows calls up to the limit", () => {
    const name = "test-allows-up-to-limit";

    expect(() => {
      checkRateLimit("user-1", { name, ...LIMIT });
      checkRateLimit("user-1", { name, ...LIMIT });
      checkRateLimit("user-1", { name, ...LIMIT });
    }).not.toThrow();
  });

  it("throws on the call past the limit", () => {
    const name = "test-throws-past-limit";
    for (let i = 0; i < LIMIT.maxRequests; i++) {
      checkRateLimit("user-1", { name, ...LIMIT });
    }

    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).toThrow(/Rate limit exceeded/);
  });

  /** The recruiter has to be able to tell how long they are waiting. */
  it("names the allowance and the window in the error", () => {
    const name = "test-error-message";
    for (let i = 0; i < 3; i++) checkRateLimit("user-1", { name, maxRequests: 3, windowMs: 300_000 });

    expect(() =>
      checkRateLimit("user-1", { name, maxRequests: 3, windowMs: 300_000 }),
    ).toThrow("Maximum 3 requests per 5 minute(s)");
  });

  it("counts each user separately", () => {
    const name = "test-per-user";
    for (let i = 0; i < LIMIT.maxRequests; i++) {
      checkRateLimit("noisy-user", { name, ...LIMIT });
    }

    expect(() => checkRateLimit("quiet-user", { name, ...LIMIT })).not.toThrow();
  });

  /**
   * Buckets are named per operation ("ai-generate", "resume-rescore",
   * "voice-screening-submit"). Sharing a counter across them would let a
   * recruiter exhaust their re-scores by drafting job descriptions.
   */
  it("counts each named bucket separately", () => {
    for (let i = 0; i < LIMIT.maxRequests; i++) {
      checkRateLimit("user-1", { name: "test-bucket-a", ...LIMIT });
    }

    expect(() => checkRateLimit("user-1", { name: "test-bucket-b", ...LIMIT })).not.toThrow();
  });

  /**
   * The window has to actually slide. If it did not, the first burst of the
   * process would lock that user out of that operation permanently — and
   * because the store is in-memory, nothing short of a redeploy would clear it.
   */
  it("lets the user back in once the window has passed", () => {
    vi.useFakeTimers();
    const name = "test-window-slides";

    for (let i = 0; i < LIMIT.maxRequests; i++) {
      checkRateLimit("user-1", { name, ...LIMIT });
    }
    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).toThrow();

    vi.advanceTimersByTime(LIMIT.windowMs + 1);

    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).not.toThrow();
  });

  /** Sliding, not fixed: a call just inside the window still counts. */
  it("still counts a call made just inside the window", () => {
    vi.useFakeTimers();
    const name = "test-window-is-sliding";

    checkRateLimit("user-1", { name, ...LIMIT });
    vi.advanceTimersByTime(LIMIT.windowMs - 1_000);
    checkRateLimit("user-1", { name, ...LIMIT });
    checkRateLimit("user-1", { name, ...LIMIT });

    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).toThrow();
  });

  it("expires timestamps one at a time as they age out", () => {
    vi.useFakeTimers();
    const name = "test-partial-expiry";

    checkRateLimit("user-1", { name, ...LIMIT });
    vi.advanceTimersByTime(30_000);
    checkRateLimit("user-1", { name, ...LIMIT });
    checkRateLimit("user-1", { name, ...LIMIT });
    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).toThrow();

    // Only the first timestamp has aged out — that buys exactly one more call.
    vi.advanceTimersByTime(30_001);
    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).not.toThrow();
    expect(() => checkRateLimit("user-1", { name, ...LIMIT })).toThrow();
  });

  /**
   * The prune is what stops the per-bucket map growing for the life of the
   * process — one entry per user who ever hit that operation. It runs on a
   * later caller's turn, so it is only observable through behaviour: an
   * aged-out user must not be holding a slot against anyone.
   */
  it("drops an idle user's entry without affecting the caller", () => {
    vi.useFakeTimers();
    const name = "test-prune";

    for (let i = 0; i < LIMIT.maxRequests; i++) {
      checkRateLimit("gone-quiet", { name, ...LIMIT });
    }

    vi.advanceTimersByTime(LIMIT.windowMs + 1);
    checkRateLimit("still-here", { name, ...LIMIT });

    expect(() => checkRateLimit("gone-quiet", { name, ...LIMIT })).not.toThrow();
    expect(() => checkRateLimit("still-here", { name, ...LIMIT })).not.toThrow();
  });

  /** A limiter that allows nothing should say so on the first call, not the second. */
  it("refuses immediately when the allowance is zero", () => {
    expect(() =>
      checkRateLimit("user-1", { name: "test-zero-allowance", maxRequests: 0, windowMs: 60_000 }),
    ).toThrow(/Rate limit exceeded/);
  });
});
