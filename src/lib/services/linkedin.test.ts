import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLinkedInConsentUrl,
  exchangeLinkedInCode,
  fetchLinkedInProfile,
  publishLinkedInText,
  isLinkedInConfigured,
} from "./linkedin";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(init.headers ?? {}),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.LINKEDIN_CLIENT_ID = "client-123";
  process.env.LINKEDIN_CLIENT_SECRET = "secret-abc";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("isLinkedInConfigured", () => {
  it("is false when credentials are missing", () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    expect(isLinkedInConfigured()).toBe(false);
  });

  it("is true when both credentials are set", () => {
    expect(isLinkedInConfigured()).toBe(true);
  });
});

describe("buildLinkedInConsentUrl", () => {
  it("includes client id, redirect, state, and the w_member_social scope", () => {
    const url = buildLinkedInConsentUrl("https://app.test/cb", "state-xyz");

    expect(url).toContain("client_id=client-123");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fapp.test%2Fcb");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("w_member_social");
  });

  it("throws when credentials are not configured", () => {
    delete process.env.LINKEDIN_CLIENT_SECRET;
    expect(() => buildLinkedInConsentUrl("https://app.test/cb", "s")).toThrow(/LINKEDIN_CLIENT/);
  });
});

describe("exchangeLinkedInCode", () => {
  it("returns the access token and a computed expiry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "tok-1", expires_in: 3600, scope: "w_member_social" }),
    );

    const token = await exchangeLinkedInCode("https://app.test/cb", "code-1");

    expect(token.accessToken).toBe("tok-1");
    expect(token.scope).toBe("w_member_social");
    expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("throws on a non-OK token response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, { ok: false, status: 400 }));

    await expect(exchangeLinkedInCode("https://app.test/cb", "bad")).rejects.toThrow(/token exchange failed/i);
  });
});

describe("fetchLinkedInProfile", () => {
  it("returns the member id from the userinfo sub", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ sub: "member-9", name: "Ada Lovelace" }));

    const profile = await fetchLinkedInProfile("tok-1");

    expect(profile.memberId).toBe("member-9");
    expect(profile.name).toBe("Ada Lovelace");
  });

  it("throws when the profile has no member id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ name: "No Sub" }));

    await expect(fetchLinkedInProfile("tok-1")).rejects.toThrow(/no member id/i);
  });
});

describe("publishLinkedInText", () => {
  it("posts the author URN and commentary, returning the post URN", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({}, { headers: { "x-restli-id": "urn:li:share:123" } }),
    );

    const result = await publishLinkedInText({
      accessToken: "tok-1",
      memberId: "member-9",
      text: "We're hiring!",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.author).toBe("urn:li:person:member-9");
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text).toBe("We're hiring!");
    expect(result.postUrn).toBe("urn:li:share:123");
  });

  it("throws with LinkedIn's status on failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: "nope" }, { ok: false, status: 422 }));

    await expect(
      publishLinkedInText({ accessToken: "t", memberId: "m", text: "x" }),
    ).rejects.toThrow(/post failed \(422\)/i);
  });
});
