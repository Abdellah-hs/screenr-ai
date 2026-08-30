import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const { getRequestOrigin } = await import("./origin");

/**
 * The origin every candidate-facing link is built on: `/respond/<token>`,
 * `/interview/<token>`, `/prep/<token>`, `/schedule/<token>`. All of them go
 * out by email, to someone with no account and no other way back in, so a wrong
 * scheme or a wrong host is not a cosmetic bug — it is a candidate who cannot
 * reach their screening before the link expires and is swept to
 * `screening_expired`.
 *
 * Nothing tested it, and it is exactly the kind of header-plumbing that looks
 * obviously right and behaves differently behind a proxy.
 */

/** Serve a fixed header map, the way a request would. */
function withHeaders(map: Record<string, string>) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });
}

beforeEach(() => {
  mockHeaders.mockReset();
});

describe("getRequestOrigin", () => {
  it("prefers the forwarded host and scheme behind a proxy", async () => {
    withHeaders({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "hire.example.com",
      host: "internal-vercel-host.local",
    });

    expect(await getRequestOrigin()).toBe("https://hire.example.com");
  });

  it("falls back to the Host header when nothing was forwarded", async () => {
    withHeaders({ host: "hire.example.com" });

    expect(await getRequestOrigin()).toBe("https://hire.example.com");
  });

  /**
   * The default has to be https: these links are emailed and then live for
   * seven days, so guessing http would ship a plaintext URL carrying a signed
   * screening token to every candidate on the campaign.
   */
  it("assumes https for a real host when the proxy did not say", async () => {
    withHeaders({ host: "screenr.matiouscorp.com" });

    expect(await getRequestOrigin()).toBe("https://screenr.matiouscorp.com");
  });

  /** …and http for localhost, or every link in local dev is unreachable. */
  it("assumes http for localhost", async () => {
    withHeaders({ host: "localhost:3000" });

    expect(await getRequestOrigin()).toBe("http://localhost:3000");
  });

  it("honours an explicit forwarded scheme even on localhost", async () => {
    withHeaders({ "x-forwarded-proto": "https", host: "localhost:3000" });

    expect(await getRequestOrigin()).toBe("https://localhost:3000");
  });

  it("keeps the port, which is part of the origin", async () => {
    withHeaders({ "x-forwarded-host": "hire.example.com:8443", "x-forwarded-proto": "https" });

    expect(await getRequestOrigin()).toBe("https://hire.example.com:8443");
  });

  /**
   * Throwing is right. The alternative is composing a link against an empty
   * host and emailing `https:///respond/<token>` to a candidate — a dead link
   * that looks like a live one, sent to someone who cannot ask us about it.
   */
  it("throws rather than build a link with no host", async () => {
    withHeaders({});

    await expect(getRequestOrigin()).rejects.toThrow(/determine request origin/i);
  });

  it("throws when only a scheme was forwarded", async () => {
    withHeaders({ "x-forwarded-proto": "https" });

    await expect(getRequestOrigin()).rejects.toThrow(/determine request origin/i);
  });
});
