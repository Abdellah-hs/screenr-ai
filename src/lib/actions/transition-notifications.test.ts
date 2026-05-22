import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchContext, mockSendEmail } = vi.hoisted(() => ({
  mockFetchContext: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationEmailContext: mockFetchContext,
}));

vi.mock("@/lib/services/email", () => ({
  sendEmail: mockSendEmail,
}));

import { sendTransitionNotification } from "./transition-notifications";

const CONTEXT = {
  candidateName: "Jane Doe",
  candidateEmail: "jane@example.com",
  campaignTitle: "Senior Engineer",
};

beforeEach(() => {
  mockFetchContext.mockReset();
  mockSendEmail.mockReset();
  mockFetchContext.mockResolvedValue(CONTEXT);
  mockSendEmail.mockResolvedValue("msg-1");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sendTransitionNotification", () => {
  it("emails the candidate the advance email on transition to interview_scheduling", async () => {
    await sendTransitionNotification("app-1", "interview_scheduling");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toBe("jane@example.com");
    expect(sent.subject).toContain("Senior Engineer");
  });

  it("emails the candidate the rejection email on transition to rejected", async () => {
    await sendTransitionNotification("app-1", "rejected");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].text).toContain("not to move forward");
  });

  it("sends nothing for a state with no candidate-facing notification", async () => {
    await sendTransitionNotification("app-1", "screening_scored");

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when the application context cannot be loaded", async () => {
    mockFetchContext.mockResolvedValueOnce(null);

    await sendTransitionNotification("app-1", "rejected");

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("never throws when the email transport fails — the transition is already durable", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("Gmail unavailable"));

    await expect(
      sendTransitionNotification("app-1", "rejected"),
    ).resolves.toBeUndefined();
  });
});
