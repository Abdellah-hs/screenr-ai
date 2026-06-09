import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateAuthUrl,
  mockGetToken,
  mockSetCredentials,
  mockGetProfile,
  mockOAuth2,
  mockGmailFactory,
} = vi.hoisted(() => {
  const mockGenerateAuthUrl = vi.fn();
  const mockGetToken = vi.fn();
  const mockSetCredentials = vi.fn();
  const mockGetProfile = vi.fn();
  // Constructor-style mock: invoked via `new google.auth.OAuth2(...)`, so the
  // implementation must assign to `this` (an arrow fn can't be `new`-ed).
  const mockOAuth2 = vi.fn(function (
    this: {
      generateAuthUrl: typeof mockGenerateAuthUrl;
      getToken: typeof mockGetToken;
      setCredentials: typeof mockSetCredentials;
    },
  ) {
    this.generateAuthUrl = mockGenerateAuthUrl;
    this.getToken = mockGetToken;
    this.setCredentials = mockSetCredentials;
  });
  const mockGmailFactory = vi.fn(() => ({
    users: { getProfile: mockGetProfile },
  }));
  return {
    mockGenerateAuthUrl,
    mockGetToken,
    mockSetCredentials,
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
  isSupportedResumeMimeType,
  buildGmailConsentUrl,
  exchangeCodeForTokens,
  getConnectedEmail,
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

describe("isSupportedResumeMimeType", () => {
  it("returns true for application/pdf", () => {
    expect(isSupportedResumeMimeType("application/pdf")).toBe(true);
  });

  it("returns true for the DOCX OOXML mime type", () => {
    expect(
      isSupportedResumeMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(true);
  });

  it("returns false for legacy .doc (application/msword)", () => {
    expect(isSupportedResumeMimeType("application/msword")).toBe(false);
  });

  it("returns false for unrelated mime types", () => {
    expect(isSupportedResumeMimeType("image/png")).toBe(false);
    expect(isSupportedResumeMimeType("text/plain")).toBe(false);
    expect(isSupportedResumeMimeType("")).toBe(false);
  });
});

describe("buildGmailConsentUrl", () => {
  it("requests offline access with forced consent, gmail.modify scope, and the CSRF state", () => {
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
        scope: [GMAIL_MODIFY_SCOPE],
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
