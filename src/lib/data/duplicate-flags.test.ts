import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockIs = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockOrder = vi.fn();
const mockDelete = vi.fn();

const mockSupabase = {
  from: mockFrom,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

// A SEPARATE spy from the session client on purpose: the point of these tests
// is which read/write goes through which client.
const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

import {
  findCandidateByEmail,
  findCandidateByPhone,
  flagDuplicateCandidate,
  fetchDuplicateFlags,
  fetchDuplicateFlagById,
  resolveDuplicateFlag,
  mergeCandidatesTx,
  fetchOpenDuplicateFlagsWithCandidates,
} from "./duplicate-flags";

function chainReturn(value: unknown) {
  return { data: value, error: null };
}

function chainError(message: string) {
  return { data: null, error: { message } };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default chaining: from -> select -> eq -> single / order / etc.
  mockFrom.mockReturnValue(mockSupabase);
  mockSupabase.from = mockFrom;

  // We need to rebuild chainable objects each call because some methods return new objects
  mockFrom.mockImplementation(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  }));

  mockSelect.mockImplementation(() => ({
    eq: mockEq,
    order: mockOrder,
    single: mockSingle,
  }));

  mockEq.mockImplementation(() => ({
    eq: mockEq,
    single: mockSingle,
    order: mockOrder,
    is: mockIs,
  }));

  // Finder chain: .is("deleted_at", null).order(...).limit(1).maybeSingle()
  mockIs.mockImplementation(() => ({
    order: mockOrder,
  }));

  mockOrder.mockImplementation(() => ({
    single: mockSingle,
    limit: mockLimit,
  }));

  mockLimit.mockImplementation(() => ({
    maybeSingle: mockMaybeSingle,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findCandidateByEmail", () => {
  it("returns the earliest live candidate id when a match exists", async () => {
    mockMaybeSingle.mockResolvedValue(chainReturn({ id: "candidate-1" }));

    const result = await findCandidateByEmail("alice@example.com");

    expect(result).toEqual({ id: "candidate-1" });
    expect(mockFrom).toHaveBeenCalledWith("candidates");
    expect(mockSelect).toHaveBeenCalledWith("id");
    expect(mockEq).toHaveBeenCalledWith("email", "alice@example.com");
    // Merged-away (soft-deleted) records must not be matched.
    expect(mockIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns null when no match is found", async () => {
    mockMaybeSingle.mockResolvedValue(chainReturn(null));

    const result = await findCandidateByEmail("nobody@example.com");

    expect(result).toBeNull();
  });

  it("still returns a match when the email already has duplicates (no single() throw)", async () => {
    // Pre-existing duplicate: limit(1)+maybeSingle yields the first row rather
    // than erroring — so later applicants keep getting flagged.
    mockMaybeSingle.mockResolvedValue(chainReturn({ id: "candidate-oldest" }));

    const result = await findCandidateByEmail("dupe@example.com");

    expect(result).toEqual({ id: "candidate-oldest" });
    expect(mockLimit).toHaveBeenCalledWith(1);
  });
});

describe("findCandidateByPhone", () => {
  it("returns the earliest live candidate id when a match exists", async () => {
    mockMaybeSingle.mockResolvedValue(chainReturn({ id: "candidate-2" }));

    const result = await findCandidateByPhone("+1-555-1234");

    expect(result).toEqual({ id: "candidate-2" });
    expect(mockEq).toHaveBeenCalledWith("phone", "+1-555-1234");
    expect(mockIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns null when no match is found", async () => {
    mockMaybeSingle.mockResolvedValue(chainReturn(null));

    const result = await findCandidateByPhone("+1-000-0000");

    expect(result).toBeNull();
  });
});

describe("flagDuplicateCandidate", () => {
  it("inserts a flag row and returns its id", async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(chainReturn({ id: "flag-1" })),
      }),
    });

    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: insertMock,
      update: mockUpdate,
      delete: mockDelete,
    }));

    const id = await flagDuplicateCandidate({
      candidateId: "candidate-new",
      matchedCandidateId: "candidate-existing",
      matchSignals: { email_match: true, matched_email: "alice@example.com" },
    });

    expect(id).toBe("flag-1");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_id: "candidate-new",
        matched_candidate_id: "candidate-existing",
        status: "open",
      }),
    );
  });

  it("throws when the insert fails", async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(chainError("db down")),
      }),
    });

    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: insertMock,
      update: mockUpdate,
      delete: mockDelete,
    }));

    await expect(
      flagDuplicateCandidate({
        candidateId: "c1",
        matchedCandidateId: "c2",
        matchSignals: {},
      }),
    ).rejects.toThrow("db down");
  });
});

describe("fetchDuplicateFlags", () => {
  it("returns mapped flags ordered by created_at desc", async () => {
    mockOrder.mockImplementation(() => ({
      single: mockSingle,
    }));

    // Override the eq chaining for this test because fetchDuplicateFlags doesn't use eq
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "flag-1",
              candidate_id: "c1",
              matched_candidate_id: "c2",
              match_signals: { email_match: true },
              status: "open",
              reviewer_user_id: null,
              rationale: null,
              created_at: "2026-05-01T00:00:00Z",
              updated_at: "2026-05-01T00:00:00Z",
              resolved_at: null,
            },
          ],
          error: null,
        }),
      }),
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
    }));

    const flags = await fetchDuplicateFlags();

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      id: "flag-1",
      status: "open",
      match_signals: { email_match: true },
    });
  });

  it("throws when the query fails", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: null, error: { message: "timeout" } }),
      }),
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
    }));

    await expect(fetchDuplicateFlags()).rejects.toThrow("timeout");
  });
});

describe("fetchDuplicateFlagById", () => {
  it("returns the flag when found", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: "flag-2",
        candidate_id: "c3",
        matched_candidate_id: "c4",
        match_signals: { phone_match: true },
        status: "approved",
        reviewer_user_id: "user-1",
        rationale: "Same person",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
        resolved_at: "2026-05-01T01:00:00Z",
      },
      error: null,
    });

    const flag = await fetchDuplicateFlagById("flag-2");

    expect(flag).not.toBeNull();
    expect(flag?.status).toBe("approved");
    expect(flag?.match_signals).toEqual({ phone_match: true });
  });

  it("returns null when not found", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "not found" } });

    const flag = await fetchDuplicateFlagById("flag-missing");

    expect(flag).toBeNull();
  });
});

describe("resolveDuplicateFlag", () => {
  it("updates the flag with approved status, reviewer, and resolved_at", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: updateMock,
      delete: mockDelete,
    }));

    await resolveDuplicateFlag({
      flagId: "flag-3",
      decision: "approved",
      reviewerUserId: "user-1",
      rationale: "Confirmed duplicate by email and phone.",
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        reviewer_user_id: "user-1",
        rationale: "Confirmed duplicate by email and phone.",
        resolved_at: expect.any(String),
      }),
    );
  });

  it("throws when the update fails", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: "write conflict" } }),
    });

    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: updateMock,
      delete: mockDelete,
    }));

    await expect(
      resolveDuplicateFlag({
        flagId: "flag-3",
        decision: "rejected",
        reviewerUserId: "user-1",
        rationale: "Different people.",
      }),
    ).rejects.toThrow("write conflict");
  });
});

describe("mergeCandidatesTx", () => {
  /** Session-client `.update().eq()` — the applications re-point. */
  function sessionUpdate(result: { error: { message: string } | null }) {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(result),
    });
    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: mockInsert,
      update,
      delete: mockDelete,
    }));
    return update;
  }

  /** Admin-client `.update().eq().select()` — the soft-delete. */
  function adminUpdate(result: {
    data: { id: string }[] | null;
    error: { message: string } | null;
  }) {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue(result),
      }),
    });
    mockAdminFrom.mockImplementation(() => ({ update }));
    return update;
  }

  it("re-points applications and soft-deletes the source candidate", async () => {
    const appUpdate = sessionUpdate({ error: null });
    const candUpdate = adminUpdate({ data: [{ id: "source-c" }], error: null });

    await mergeCandidatesTx("source-c", "target-c");

    expect(appUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ candidate_id: "target-c" }),
    );
    expect(candUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
  });

  it("soft-deletes through the admin client, not the session client", async () => {
    // Regression: candidates UPDATE is gated on the row having an application
    // in one of the reader's campaigns, and the re-point above has just moved
    // every one of them away. On the session client that update matched 0 rows
    // and still reported success, so the merged-away candidate stayed live and
    // kept winning findCandidateByEmail for every later applicant.
    sessionUpdate({ error: null });
    adminUpdate({ data: [{ id: "source-c" }], error: null });

    await mergeCandidatesTx("source-c", "target-c");

    expect(mockAdminFrom).toHaveBeenCalledWith("candidates");
    expect(mockFrom).not.toHaveBeenCalledWith("candidates");
  });

  it("throws when the soft-delete matches no row", async () => {
    sessionUpdate({ error: null });
    adminUpdate({ data: [], error: null });

    await expect(mergeCandidatesTx("source-c", "target-c")).rejects.toThrow(
      /left candidate source-c live/,
    );
  });

  it("throws when re-pointing applications fails", async () => {
    sessionUpdate({ error: { message: "fk violation" } });
    adminUpdate({ data: [{ id: "s" }], error: null });

    await expect(mergeCandidatesTx("s", "t")).rejects.toThrow("fk violation");
  });
});

describe("fetchOpenDuplicateFlagsWithCandidates", () => {
  function flagRow(over: Record<string, unknown> = {}) {
    return {
      id: "flag-1",
      candidate_id: "new-c",
      matched_candidate_id: "old-c",
      match_signals: { email_match: true },
      status: "open",
      reviewer_user_id: null,
      rationale: null,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      resolved_at: null,
      ...over,
    };
  }

  function candidateRow(id: string, email: string) {
    return {
      id,
      first_name: "Ada",
      last_name: "Lovelace",
      email,
      phone: "+1",
      created_at: "2026-04-17T00:00:00.000Z",
    };
  }

  /** Session client: from("duplicate_review_queue").select().eq().order() */
  function openFlags(rows: unknown[]) {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }));
  }

  /** Admin client: from("candidates").select().in() */
  function visibleCandidates(rows: unknown[]) {
    const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
    mockAdminFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({ in: inFn }),
    }));
    return inFn;
  }

  it("enriches each open flag with both candidate records", async () => {
    openFlags([flagRow()]);
    visibleCandidates([
      candidateRow("new-c", "new@example.com"),
      candidateRow("old-c", "old@example.com"),
    ]);

    const items = await fetchOpenDuplicateFlagsWithCandidates();

    expect(items).toHaveLength(1);
    expect(items[0].candidate.email).toBe("new@example.com");
    expect(items[0].matched.email).toBe("old@example.com");
  });

  it("reads the candidate pair through the admin client", async () => {
    // Regression: on the session client, candidates SELECT requires an
    // application in one of the reader's campaigns. A candidate orphaned by a
    // campaign delete fails that forever, so every flag naming it was dropped
    // from the queue with no error — 44 of 47 open flags on one live database.
    openFlags([flagRow()]);
    const inFn = visibleCandidates([
      candidateRow("new-c", "new@example.com"),
      candidateRow("old-c", "old@example.com"),
    ]);

    await fetchOpenDuplicateFlagsWithCandidates();

    expect(mockAdminFrom).toHaveBeenCalledWith("candidates");
    expect(mockFrom).not.toHaveBeenCalledWith("candidates");
    expect(inFn).toHaveBeenCalledWith("id", ["new-c", "old-c"]);
  });

  it("logs the flag id when a candidate row no longer exists", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    openFlags([flagRow({ id: "orphaned-flag" })]);
    visibleCandidates([candidateRow("new-c", "new@example.com")]); // old-c gone

    const items = await fetchOpenDuplicateFlagsWithCandidates();

    expect(items).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("1 open flag(s)"), [
      "orphaned-flag",
    ]);
  });

  it("returns an empty queue without querying candidates when no flags are open", async () => {
    openFlags([]);
    visibleCandidates([]);

    const items = await fetchOpenDuplicateFlagsWithCandidates();

    expect(items).toEqual([]);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });
});
