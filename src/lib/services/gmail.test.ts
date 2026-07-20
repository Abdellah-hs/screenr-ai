import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateAuthUrl,
  mockGetToken,
  mockSetCredentials,
  mockGetAccessToken,
  mockGetProfile,
  mockOAuth2,
  mockGmailFactory,
} = vi.hoisted(() => {
  const mockGenerateAuthUrl = vi.fn();
  const mockGetToken = vi.fn();
  const mockSetCredentials = vi.fn();
  const mockGetAccessToken = vi.fn();
  const mockGetProfile = vi.fn();
  // Constructor-style mock: invoked via `new google.auth.OAuth2(...)`, so the
  // implementation must assign to `this` (an arrow fn can't be `new`-ed).
  const mockOAuth2 = vi.fn(function (
    this: {
      generateAuthUrl: typeof mockGenerateAuthUrl;
      getToken: typeof mockGetToken;
      setCredentials: typeof mockSetCredentials;
      getAccessToken: typeof mockGetAccessToken;
    },
  ) {
    this.generateAuthUrl = mockGenerateAuthUrl;
    this.getToken = mockGetToken;
    this.setCredentials = mockSetCredentials;
    this.getAccessToken = mockGetAccessToken;
  });
  const mockGmailFactory = vi.fn(() => ({
    users: { getProfile: mockGetProfile },
  }));
  return {
    mockGenerateAuthUrl,
    mockGetToken,
    mockSetCredentials,
    mockGetAccessToken,
    mockGetProfile,
    mockOAuth2,
    mockGmailFactory,
  };
});

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: mockOAuth2 },
    gmail: mockGmailFactory,
  },
}));

import {
  buildGmailConsentUrl,
  exchangeCodeForTokens,
  getConnectedEmail,
  hasCalendarScopes,
  verifyRefreshToken,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
} from "./gmail";

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("buildGmailConsentUrl", () => {
  it("requests offline access with forced consent, gmail + calendar scopes, and the CSRF state", () => {
    mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/auth?x=1");

    const url = buildGmailConsentUrl("https://app.test/cb", "state-123");

    expect(url).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
    expect(mockOAuth2).toHaveBeenCalledWith(
      "test-client-id",
      "test-client-secret",
      "https://app.test/cb",
    );
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        state: "state-123",
        scope: [GMAIL_MODIFY_SCOPE, CALENDAR_FREEBUSY_SCOPE, CALENDAR_EVENTS_SCOPE],
      }),
    );
  });

  it("throws when the OAuth app credentials are missing from env", () => {
    delete process.env.GOOGLE_CLIENT_ID;

    expect(() => buildGmailConsentUrl("https://app.test/cb", "s")).toThrow(
      /GOOGLE_CLIENT_ID/,
    );
  });
});

describe("hasCalendarScopes", () => {
  it("returns true when the grant includes both calendar scopes", () => {
    const scope = `${GMAIL_MODIFY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`;
    expect(hasCalendarScopes(scope)).toBe(true);
  });

  it("returns false for a pre-calendar grant (gmail only)", () => {
    expect(hasCalendarScopes(GMAIL_MODIFY_SCOPE)).toBe(false);
  });

  it("returns false when only one of the two calendar scopes was granted", () => {
    expect(hasCalendarScopes(`${GMAIL_MODIFY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}`)).toBe(false);
    expect(hasCalendarScopes(`${GMAIL_MODIFY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`)).toBe(false);
  });

  it("returns false for a null or empty stored scope", () => {
    expect(hasCalendarScopes(null)).toBe(false);
    expect(hasCalendarScopes("")).toBe(false);
  });

  it("does not accept a readonly variant as a substring match", () => {
    const scope = `${CALENDAR_FREEBUSY_SCOPE} ${CALENDAR_EVENTS_SCOPE}.readonly`;
    expect(hasCalendarScopes(scope)).toBe(false);
  });
});

describe("exchangeCodeForTokens", () => {
  it("returns the refresh token and granted scope from the token response", async () => {
    mockGetToken.mockResolvedValue({
      tokens: { refresh_token: "rt-xyz", scope: "scope-a scope-b" },
    });

    const result = await exchangeCodeForTokens("https://app.test/cb", "auth-code");

    expect(result).toEqual({ refreshToken: "rt-xyz", scope: "scope-a scope-b" });
    expect(mockGetToken).toHaveBeenCalledWith("auth-code");
  });

  it("throws when Google does not return a refresh token", async () => {
    mockGetToken.mockResolvedValue({ tokens: { access_token: "at-only" } });

    await expect(
      exchangeCodeForTokens("https://app.test/cb", "auth-code"),
    ).rejects.toThrow(/refresh token/i);
  });
});

describe("getConnectedEmail", () => {
  it("reads the mailbox address via the profile, binding the refresh token", async () => {
    mockGetProfile.mockResolvedValue({ data: { emailAddress: "jobs@acme.com" } });

    const email = await getConnectedEmail("rt-xyz");

    expect(email).toBe("jobs@acme.com");
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: "rt-xyz" });
  });

  it("throws when the profile has no email address", async () => {
    mockGetProfile.mockResolvedValue({ data: {} });

    await expect(getConnectedEmail("rt-xyz")).rejects.toThrow();
  });
});

describe("verifyRefreshToken", () => {
  it("returns true when the token mints an access token", async () => {
    mockGetAccessToken.mockResolvedValue({ token: "at-live" });

    const result = await verifyRefreshToken("rt-live");

    expect(result).toBe(true);
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: "rt-live" });
  });

  it("returns false when Google rejects the token as invalid_grant", async () => {
    mockGetAccessToken.mockRejectedValue({
      response: { data: { error: "invalid_grant" } },
    });

    expect(await verifyRefreshToken("rt-dead")).toBe(false);
  });

  it("returns false when invalid_grant only appears in the error message", async () => {
    mockGetAccessToken.mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked."));

    expect(await verifyRefreshToken("rt-dead")).toBe(false);
  });

  it("re-throws transient errors so a working connection isn't flipped on a blip", async () => {
    mockGetAccessToken.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(verifyRefreshToken("rt-live")).rejects.toThrow("ETIMEDOUT");
  });
});
