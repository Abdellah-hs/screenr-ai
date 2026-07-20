import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateAdminClient,
  mockFetchGmailConnection,
  mockListChangedCalendarEvents,
  mockStopCalendarWatch,
  mockWatchCalendarEvents,
  mockFetchBookingByGoogleEventId,
  mockMarkBookingPendingReschedule,
  mockAcquireReconcileLock,
  mockFetchWatchChannelByOwner,
  mockReleaseReconcileLock,
  mockUpdateWatchSyncToken,
  mockUpsertWatchChannel,
  mockFetchApplicationEmailContext,
  mockGetRecruiterGmailClient,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockFetchGmailConnection: vi.fn(),
  mockListChangedCalendarEvents: vi.fn(),
  mockStopCalendarWatch: vi.fn(),
  mockWatchCalendarEvents: vi.fn(),
  mockFetchBookingByGoogleEventId: vi.fn(),
  mockMarkBookingPendingReschedule: vi.fn(),
  mockAcquireReconcileLock: vi.fn(),
  mockFetchWatchChannelByOwner: vi.fn(),
  mockReleaseReconcileLock: vi.fn(),
  mockUpdateWatchSyncToken: vi.fn(),
  mockUpsertWatchChannel: vi.fn(),
  mockFetchApplicationEmailContext: vi.fn(),
  mockGetRecruiterGmailClient: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/data/integrations", () => ({ fetchGmailConnection: mockFetchGmailConnection }));
vi.mock("@/lib/data/scheduling", () => ({
  fetchBookingByGoogleEventId: mockFetchBookingByGoogleEventId,
  markBookingPendingReschedule: mockMarkBookingPendingReschedule,
}));
vi.mock("@/lib/data/calendar-watch", () => ({
  acquireReconcileLock: mockAcquireReconcileLock,
  fetchWatchChannelByOwner: mockFetchWatchChannelByOwner,
  releaseReconcileLock: mockReleaseReconcileLock,
  updateWatchSyncToken: mockUpdateWatchSyncToken,
  upsertWatchChannel: mockUpsertWatchChannel,
}));
vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationEmailContext: mockFetchApplicationEmailContext,
}));
vi.mock("@/lib/actions/gmail-sender", () => ({
  getRecruiterGmailClient: mockGetRecruiterGmailClient,
}));
vi.mock("@/lib/services/email", () => ({ sendEmail: mockSendEmail }));

// The calendar service is mocked wholesale, but SyncTokenExpiredError must stay
// real so `instanceof` in the orchestration actually matches.
vi.mock("@/lib/services/calendar", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/calendar")>(
    "@/lib/services/calendar",
  );
  return {
    SyncTokenExpiredError: actual.SyncTokenExpiredError,
    listChangedCalendarEvents: mockListChangedCalendarEvents,
    stopCalendarWatch: mockStopCalendarWatch,
    watchCalendarEvents: mockWatchCalendarEvents,
  };
});

// `hasCalendarScopes` stays real so the scope gate is exercised.
import { SyncTokenExpiredError } from "@/lib/services/calendar";
import { ensureWatchChannel, reconcileCalendarChanges } from "./calendar-sync";
import { CALENDAR_EVENTS_SCOPE, CALENDAR_FREEBUSY_SCOPE } from "@/lib/services/gmail";

const FULL_SCOPE = `gmail ${CALENDAR_FREEBUSY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`;
const ADMIN_DB = { __brand: "admin" };
const NOW = new Date("2026-07-12T12:00:00.000Z");
const ORIGIN = "https://app.example.com";

beforeEach(() => {
  vi.clearAllMocks();
  // The reschedule email mints a signed /schedule token, which needs the secret.
  process.env.SCREENING_TOKEN_SECRET = "test-secret-at-least-32-chars-long!!";
  mockCreateAdminClient.mockReturnValue(ADMIN_DB);
  mockFetchGmailConnection.mockResolvedValue({ refresh_token: "rt-1", scope: FULL_SCOPE });
  mockAcquireReconcileLock.mockResolvedValue(true);
  mockReleaseReconcileLock.mockResolvedValue(undefined);
  mockUpdateWatchSyncToken.mockResolvedValue(undefined);
  mockFetchApplicationEmailContext.mockResolvedValue({
    candidateName: "Jane Doe",
    candidateEmail: "jane@example.com",
    campaignTitle: "Engineer",
  });
  mockGetRecruiterGmailClient.mockResolvedValue({ __brand: "gmail" });
  mockSendEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCREENING_TOKEN_SECRET;
});

describe("reconcileCalendarChanges", () => {
  const CHANNEL = {
    channel_id: "chan-1",
    resource_id: "res-1",
    channel_token: "tok-1",
    sync_token: "sync-1",
    expiration: "2026-07-19T12:00:00.000Z",
  };

  it("returns early without calling Google when the mutex is already held", async () => {
    mockAcquireReconcileLock.mockResolvedValue(false);

    const result = await reconcileCalendarChanges({
      ownerUserId: "owner-1",
      scheduleOrigin: ORIGIN,
      now: NOW,
    });

    expect(result).toEqual({ ran: false, rescheduled: 0 });
    expect(mockFetchWatchChannelByOwner).not.toHaveBeenCalled();
    expect(mockListChangedCalendarEvents).not.toHaveBeenCalled();
    expect(mockReleaseReconcileLock).not.toHaveBeenCalled();
  });

  it("flips a booked event whose time changed and emails the candidate once", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(CHANNEL);
    mockListChangedCalendarEvents.mockResolvedValue({
      events: [{ eventId: "evt-1", startIso: "2026-07-15T10:00:00.000Z", status: "confirmed" }],
      nextSyncToken: "sync-2",
    });
    mockFetchBookingByGoogleEventId.mockResolvedValue({
      application_id: "app-1",
      scheduled_at: "2026-07-14T09:00:00.000Z", // differs from the event's new start
      status: "booked",
    });
    mockMarkBookingPendingReschedule.mockResolvedValue(true);

    const result = await reconcileCalendarChanges({
      ownerUserId: "owner-1",
      scheduleOrigin: ORIGIN,
      now: NOW,
    });

    expect(result).toEqual({ ran: true, rescheduled: 1 });
    expect(mockMarkBookingPendingReschedule).toHaveBeenCalledWith("app-1", ADMIN_DB);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockUpdateWatchSyncToken).toHaveBeenCalledWith("owner-1", "sync-2", ADMIN_DB);
    expect(mockReleaseReconcileLock).toHaveBeenCalledWith("owner-1", ADMIN_DB);
  });

  it("does NOT email when the conditional flip reports no transition (duplicate delivery)", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(CHANNEL);
    mockListChangedCalendarEvents.mockResolvedValue({
      events: [{ eventId: "evt-1", startIso: "2026-07-15T10:00:00.000Z", status: "confirmed" }],
      nextSyncToken: "sync-2",
    });
    mockFetchBookingByGoogleEventId.mockResolvedValue({
      application_id: "app-1",
      scheduled_at: "2026-07-14T09:00:00.000Z",
      status: "booked",
    });
    // The row was already flipped by a concurrent delivery.
    mockMarkBookingPendingReschedule.mockResolvedValue(false);

    const result = await reconcileCalendarChanges({
      ownerUserId: "owner-1",
      scheduleOrigin: ORIGIN,
      now: NOW,
    });

    expect(result.rescheduled).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("ignores an unchanged time, a non-our event, and a cancelled event", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(CHANNEL);
    mockListChangedCalendarEvents.mockResolvedValue({
      events: [
        { eventId: "evt-same", startIso: "2026-07-14T09:00:00.000Z", status: "confirmed" },
        { eventId: "evt-other", startIso: "2026-07-15T10:00:00.000Z", status: "confirmed" },
        { eventId: "evt-del", startIso: "2026-07-16T10:00:00.000Z", status: "cancelled" },
      ],
      nextSyncToken: "sync-2",
    });
    mockFetchBookingByGoogleEventId.mockImplementation(async (id: string) => {
      if (id === "evt-same") {
        return { application_id: "app-1", scheduled_at: "2026-07-14T09:00:00.000Z", status: "booked" };
      }
      if (id === "evt-other") return null; // not one of our bookings
      return null;
    });

    const result = await reconcileCalendarChanges({
      ownerUserId: "owner-1",
      scheduleOrigin: ORIGIN,
      now: NOW,
    });

    expect(result.rescheduled).toBe(0);
    expect(mockMarkBookingPendingReschedule).not.toHaveBeenCalled();
    // The cancelled event must never even be looked up.
    expect(mockFetchBookingByGoogleEventId).not.toHaveBeenCalledWith("evt-del", ADMIN_DB);
  });

  it("recovers from an expired sync token by clearing it and doing a bounded full sync", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(CHANNEL);
    mockListChangedCalendarEvents
      .mockRejectedValueOnce(new SyncTokenExpiredError())
      .mockResolvedValueOnce({ events: [], nextSyncToken: "sync-fresh" });

    await reconcileCalendarChanges({ ownerUserId: "owner-1", scheduleOrigin: ORIGIN, now: NOW });

    // First: cleared the stale token. Then: full sync bounded by timeMin, and
    // the fresh token persisted.
    expect(mockUpdateWatchSyncToken).toHaveBeenNthCalledWith(1, "owner-1", null, ADMIN_DB);
    const secondCallArgs = mockListChangedCalendarEvents.mock.calls[1][0];
    expect(secondCallArgs.syncToken).toBeUndefined();
    expect(secondCallArgs.timeMinIso).toBe("2026-07-10T12:00:00.000Z"); // now - 48h
    expect(mockUpdateWatchSyncToken).toHaveBeenLastCalledWith("owner-1", "sync-fresh", ADMIN_DB);
  });

  it("releases the mutex even when the sync throws", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(CHANNEL);
    mockListChangedCalendarEvents.mockRejectedValue(new Error("Google 500"));

    await expect(
      reconcileCalendarChanges({ ownerUserId: "owner-1", scheduleOrigin: ORIGIN, now: NOW }),
    ).rejects.toThrow("Google 500");

    expect(mockReleaseReconcileLock).toHaveBeenCalledWith("owner-1", ADMIN_DB);
  });
});

describe("ensureWatchChannel", () => {
  const WEBHOOK = "https://app.example.com/api/webhooks/google-calendar";

  it("no-ops when a healthy channel already exists", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue({
      channel_id: "chan-1",
      resource_id: "res-1",
      sync_token: "sync-1",
      expiration: "2026-07-19T12:00:00.000Z", // ~7 days out, well beyond the renew window
    });

    const active = await ensureWatchChannel({
      ownerUserId: "owner-1",
      webhookUrl: WEBHOOK,
      now: NOW,
    });

    expect(active).toBe(true);
    expect(mockWatchCalendarEvents).not.toHaveBeenCalled();
    expect(mockUpsertWatchChannel).not.toHaveBeenCalled();
  });

  it("opens a channel on first booking and persists it with a null sync cursor", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(null);
    mockWatchCalendarEvents.mockResolvedValue({
      resourceId: "res-new",
      expirationIso: "2026-07-19T12:00:00.000Z",
    });

    const active = await ensureWatchChannel({
      ownerUserId: "owner-1",
      webhookUrl: WEBHOOK,
      now: NOW,
    });

    expect(active).toBe(true);
    expect(mockWatchCalendarEvents).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "rt-1", address: WEBHOOK }),
    );
    expect(mockUpsertWatchChannel).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", resourceId: "res-new", syncToken: null }),
      ADMIN_DB,
    );
    // Nothing to stop on a first-time channel.
    expect(mockStopCalendarWatch).not.toHaveBeenCalled();
  });

  it("renews a near-expiry channel, keeps the cursor, and stops the old channel", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue({
      channel_id: "chan-old",
      resource_id: "res-old",
      sync_token: "sync-keep",
      expiration: "2026-07-12T13:00:00.000Z", // 1h out — inside the 48h renew window
    });
    mockWatchCalendarEvents.mockResolvedValue({
      resourceId: "res-new",
      expirationIso: "2026-07-19T12:00:00.000Z",
    });

    await ensureWatchChannel({ ownerUserId: "owner-1", webhookUrl: WEBHOOK, now: NOW });

    expect(mockUpsertWatchChannel).toHaveBeenCalledWith(
      expect.objectContaining({ syncToken: "sync-keep", resourceId: "res-new" }),
      ADMIN_DB,
    );
    expect(mockStopCalendarWatch).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "chan-old", resourceId: "res-old" }),
    );
  });

  it("skips (returns false) when the owner has no calendar-enabled connection", async () => {
    mockFetchWatchChannelByOwner.mockResolvedValue(null);
    mockFetchGmailConnection.mockResolvedValue({ refresh_token: "rt", scope: "gmail-only" });

    const active = await ensureWatchChannel({
      ownerUserId: "owner-1",
      webhookUrl: WEBHOOK,
      now: NOW,
    });

    expect(active).toBe(false);
    expect(mockWatchCalendarEvents).not.toHaveBeenCalled();
  });
});
