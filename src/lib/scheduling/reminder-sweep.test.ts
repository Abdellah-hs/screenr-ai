import { beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-10T09:00:00.000Z");

const {
  mockCreateAdminClient,
  mockFetchBookings,
  mockClaim,
  mockRelease,
  mockGetGmail,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockFetchBookings: vi.fn(),
  mockClaim: vi.fn(),
  mockRelease: vi.fn(),
  mockGetGmail: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/data/scheduling", () => ({
  fetchBookingsInReminderWindow: mockFetchBookings,
  claimInterviewReminder: mockClaim,
  releaseInterviewReminder: mockRelease,
}));
vi.mock("@/lib/actions/gmail-sender", () => ({ getRecruiterGmailClient: mockGetGmail }));
vi.mock("@/lib/services/email", () => ({ sendEmail: mockSendEmail }));

import { sweepInterviewReminders } from "./reminder-sweep";

interface BookingOverrides {
  application_id?: string;
  scheduled_at?: string;
  created_at?: string;
  status?: string;
  application_status?: string;
  owner_user_id?: string;
  candidate_email?: string;
  meet_url?: string | null;
  reminder_24h_sent_at?: string | null;
  reminder_1h_sent_at?: string | null;
}

function booking(overrides: BookingOverrides = {}) {
  return {
    application_id: "app-1",
    campaign_id: "camp-1",
    scheduled_at: new Date(NOW.getTime() + 20 * HOUR).toISOString(),
    created_at: new Date(NOW.getTime() - 10 * 24 * HOUR).toISOString(),
    status: "booked",
    timezone: "Africa/Casablanca",
    meet_url: "https://meet.google.com/abc-defg-hij",
    reminder_24h_sent_at: null,
    reminder_1h_sent_at: null,
    campaign_title: "Senior Engineer",
    owner_user_id: "owner-1",
    application_status: "final_interview_scheduling",
    candidate_name: "Jane Doe",
    candidate_email: "jane@example.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAdminClient.mockReturnValue({});
  mockFetchBookings.mockResolvedValue([booking()]);
  mockClaim.mockResolvedValue(true);
  mockRelease.mockResolvedValue(undefined);
  mockGetGmail.mockResolvedValue({ gmail: true });
  mockSendEmail.mockResolvedValue("msg-1");
});

describe("sweepInterviewReminders — the happy path", () => {
  it("sends the due reminder to the candidate", async () => {
    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][1]).toMatchObject({ to: "jane@example.com" });
    expect(result).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
  });

  it("sends from the campaign owner's connected inbox", async () => {
    await sweepInterviewReminders(NOW);

    expect(mockGetGmail).toHaveBeenCalledWith("owner-1", expect.anything());
  });

  it("puts the stored Meet link in the email", async () => {
    await sweepInterviewReminders(NOW);

    expect(mockSendEmail.mock.calls[0][1].text).toContain(
      "https://meet.google.com/abc-defg-hij",
    );
  });

  it("shows the time in the zone the slot was booked in", async () => {
    await sweepInterviewReminders(NOW);

    // 05:00 UTC the next day is 06:00 in Casablanca (UTC+1).
    expect(mockSendEmail.mock.calls[0][1].text).toContain("6:00");
  });

  /**
   * One inbox lookup per recruiter, not per candidate — a campaign closing out
   * twenty final interviews must not refresh the same OAuth token twenty times.
   */
  it("reuses one Gmail client across a batch from the same owner", async () => {
    mockFetchBookings.mockResolvedValue([
      booking({ application_id: "app-1" }),
      booking({ application_id: "app-2" }),
    ]);

    await sweepInterviewReminders(NOW);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockGetGmail).toHaveBeenCalledTimes(1);
  });
});

describe("sweepInterviewReminders — double-send protection", () => {
  it("claims the reminder before sending it", async () => {
    const order: string[] = [];
    mockClaim.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    mockSendEmail.mockImplementation(async () => {
      order.push("send");
      return "msg-1";
    });

    await sweepInterviewReminders(NOW);

    expect(order).toEqual(["claim", "send"]);
  });

  /**
   * A concurrent run that already took the claim is the whole reason the claim
   * exists — losing it must mean sending nothing, not sending anyway.
   */
  it("sends nothing when another run already claimed the reminder", async () => {
    mockClaim.mockResolvedValue(false);

    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("hands the claim back when the send fails, so the next run retries", async () => {
    mockSendEmail.mockRejectedValue(new Error("Gmail disconnected"));

    const result = await sweepInterviewReminders(NOW);

    expect(mockRelease).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app-1", kind: "24h" }),
    );
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });
});

describe("sweepInterviewReminders — superseded reminders", () => {
  /**
   * A gap in the schedule can leave the 24h notice unsent until half an hour
   * before the call. It is stamped rather than sent, so no later run revives a
   * message whose moment has gone.
   */
  it("stamps a stale reminder without emailing it", async () => {
    mockFetchBookings.mockResolvedValue([
      booking({ scheduled_at: new Date(NOW.getTime() + 0.5 * HOUR).toISOString() }),
    ]);

    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ kind: "24h" }));
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ kind: "1h" }));
    expect(result).toMatchObject({ sent: 1, superseded: 1 });
  });
});

describe("sweepInterviewReminders — who does not get reminded", () => {
  it("skips a candidate whose application was closed after booking", async () => {
    mockFetchBookings.mockResolvedValue([booking({ application_status: "rejected" })]);

    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, skipped: 1, sent: 0 });
  });

  it("skips a booking with nothing due yet", async () => {
    mockFetchBookings.mockResolvedValue([
      booking({ scheduled_at: new Date(NOW.getTime() + 40 * HOUR).toISOString() }),
    ]);

    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 1, sent: 0 });
  });

  it("skips a candidate with no email address rather than throwing", async () => {
    mockFetchBookings.mockResolvedValue([booking({ candidate_email: "" })]);

    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 1 });
  });
});

describe("sweepInterviewReminders — one bad row cannot strand the rest", () => {
  it("continues the batch after a failure", async () => {
    mockFetchBookings.mockResolvedValue([
      booking({ application_id: "app-1" }),
      booking({ application_id: "app-2" }),
    ]);
    mockSendEmail
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("msg-2");

    const result = await sweepInterviewReminders(NOW);

    expect(result).toMatchObject({ scanned: 2, sent: 1, failed: 1 });
  });

  it("counts a recruiter with no connected inbox as a failure, not a send", async () => {
    mockGetGmail.mockRejectedValue(new Error("No Gmail connected."));

    const result = await sweepInterviewReminders(NOW);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });
});
