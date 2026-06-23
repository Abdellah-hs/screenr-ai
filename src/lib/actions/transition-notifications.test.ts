import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchContext, mockSendEmail, mockGetGmailClient } = vi.hoisted(() => ({
  mockFetchContext: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGetGmailClient: vi.fn(),
}));

vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationEmailContext: mockFetchContext,
}));

vi.mock("@/lib/services/email", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("./gmail-sender", () => ({
  getRecruiterGmailClient: mockGetGmailClient,
}));

vi.mock("@/lib/http/origin", () => ({
  getRequestOrigin: () => Promise.resolve("https://hire.example.com"),
}));

vi.mock("@/lib/auth/screening-token", () => ({
  signResponseToken: () => "signed-token",
}));

import { sendTransitionNotification } from "./transition-notifications";

const CONTEXT = {
  candidateName: "Jane Doe",
  candidateEmail: "jane@example.com",
  campaignTitle: "Senior Engineer",
};

const FAKE_GMAIL = { __brand: "gmail-client" } as never;
const USER_ID = "user-1";

beforeEach(() => {
  mockFetchContext.mockReset();
  mockSendEmail.mockReset();
  mockGetGmailClient.mockReset();
  mockFetchContext.mockResolvedValue(CONTEXT);
  mockSendEmail.mockResolvedValue("msg-1");
  mockGetGmailClient.mockResolvedValue(FAKE_GMAIL);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sendTransitionNotification", () => {
  it("emails the candidate a self-scheduling invite with the booking link on transition to interview_scheduling", async () => {
    await sendTransitionNotification("app-1", "interview_scheduling", USER_ID);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0][1];
    expect(sent.to).toBe("jane@example.com");
    expect(sent.subject).toContain("Senior Engineer");
    expect(sent.text).toContain("https://hire.example.com/schedule/signed-token");
    expect(sent.html).toContain("https://hire.example.com/schedule/signed-token");
  });

  it("sends from the acting recruiter's connected Gmail client", async () => {
    await sendTransitionNotification("app-1", "rejected", USER_ID);

    expect(mockGetGmailClient).toHaveBeenCalledWith(USER_ID);
    expect(mockSendEmail.mock.calls[0][0]).toBe(FAKE_GMAIL);
  });

  it("emails the candidate the rejection email on transition to rejected", async () => {
    await sendTransitionNotification("app-1", "rejected", USER_ID);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][1].text).toContain("not to move forward");
  });

  it("sends nothing for a state with no candidate-facing notification", async () => {
    await sendTransitionNotification("app-1", "screening_scored", USER_ID);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when the application context cannot be loaded", async () => {
    mockFetchContext.mockResolvedValueOnce(null);

    await sendTransitionNotification("app-1", "rejected", USER_ID);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("swallows a missing Gmail connection without throwing", async () => {
    mockGetGmailClient.mockRejectedValueOnce(new Error("No Gmail connected."));

    await expect(
      sendTransitionNotification("app-1", "rejected", USER_ID),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("never throws when the email transport fails — the transition is already durable", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("Gmail unavailable"));

    await expect(
      sendTransitionNotification("app-1", "rejected", USER_ID),
    ).resolves.toBeUndefined();
  });
});
