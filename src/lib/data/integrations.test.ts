import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMaybeSingle = vi.fn();
const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockUpsert = vi.fn();
const mockDeleteEq = vi.fn();
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  upsert: mockUpsert,
  delete: mockDelete,
}));

const mockSupabase = { from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

import {
  upsertGmailConnection,
  fetchGmailConnection,
  deleteGmailConnection,
  upsertSocialConnection,
  fetchSocialConnection,
  deleteSocialConnection,
} from "./integrations";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertGmailConnection", () => {
  it("upserts on the user_id conflict target with the connection fields", async () => {
    mockUpsert.mockResolvedValue({ error: null });

    await upsertGmailConnection({
      userId: "user-1",
      email: "jobs@acme.com",
      refreshToken: "rt-1",
      scope: "scope-x",
    });

    expect(mockFrom).toHaveBeenCalledWith("gmail_connections");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        email: "jobs@acme.com",
        refresh_token: "rt-1",
        scope: "scope-x",
      }),
      { onConflict: "user_id" },
    );
  });

  it("throws when the write fails", async () => {
    mockUpsert.mockResolvedValue({ error: new Error("db down") });

    await expect(
      upsertGmailConnection({
        userId: "user-1",
        email: "jobs@acme.com",
        refreshToken: "rt-1",
        scope: null,
      }),
    ).rejects.toThrow("db down");
  });
});

describe("fetchGmailConnection", () => {
  it("returns the full row (including refresh token) scoped to the user", async () => {
    const row = { user_id: "user-1", email: "jobs@acme.com", refresh_token: "rt-1" };
    mockMaybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchGmailConnection("user-1");

    expect(result).toBe(row);
    expect(mockSelect).toHaveBeenCalledWith("*");
    expect(mockSelectEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null when there is no connection", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    expect(await fetchGmailConnection("user-1")).toBeNull();
  });
});

describe("deleteGmailConnection", () => {
  it("deletes the row scoped to the user", async () => {
    mockDeleteEq.mockResolvedValue({ error: null });

    await deleteGmailConnection("user-1");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("throws when the delete fails", async () => {
    mockDeleteEq.mockResolvedValue({ error: new Error("nope") });

    await expect(deleteGmailConnection("user-1")).rejects.toThrow("nope");
  });
});

// The social-connection reads/writes are keyed by (user_id, provider), so their
// select/delete chains have two .eq() calls — local per-test mock chains keep
// them isolated from the single-.eq() gmail mocks above.
describe("upsertSocialConnection", () => {
  it("upserts on the (user_id, provider) conflict target", async () => {
    mockUpsert.mockResolvedValue({ error: null });

    await upsertSocialConnection({
      userId: "user-1",
      provider: "linkedin",
      accessToken: "tok-1",
      tokenExpiresAt: "2030-01-01T00:00:00.000Z",
      accountId: "member-9",
      accountName: "Ada",
      scope: "w_member_social",
    });

    expect(mockFrom).toHaveBeenCalledWith("social_connections");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        provider: "linkedin",
        access_token: "tok-1",
        account_id: "member-9",
      }),
      { onConflict: "user_id,provider" },
    );
  });
});

describe("fetchSocialConnection", () => {
  it("filters by both user_id and provider", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "conn-1" }, error: null });
    const eqProvider = vi.fn(() => ({ maybeSingle }));
    const eqUser = vi.fn(() => ({ eq: eqProvider }));
    const select = vi.fn(() => ({ eq: eqUser }));
    mockFrom.mockReturnValueOnce({ select } as never);

    const row = await fetchSocialConnection("user-1", "linkedin");

    expect(select).toHaveBeenCalledWith("*");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqProvider).toHaveBeenCalledWith("provider", "linkedin");
    expect(row).toEqual({ id: "conn-1" });
  });
});

describe("deleteSocialConnection", () => {
  it("deletes the row scoped to the user and provider", async () => {
    const eqProvider = vi.fn().mockResolvedValue({ error: null });
    const eqUser = vi.fn(() => ({ eq: eqProvider }));
    const del = vi.fn(() => ({ eq: eqUser }));
    mockFrom.mockReturnValueOnce({ delete: del } as never);

    await deleteSocialConnection("user-1", "linkedin");

    expect(del).toHaveBeenCalledTimes(1);
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqProvider).toHaveBeenCalledWith("provider", "linkedin");
  });
});
