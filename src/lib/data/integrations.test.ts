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
