import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
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

import {
  findCandidateByEmail,
  findCandidateByPhone,
  flagDuplicateCandidate,
  fetchDuplicateFlags,
  fetchDuplicateFlagById,
  resolveDuplicateFlag,
  mergeCandidatesTx,
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
  }));

  mockOrder.mockImplementation(() => ({
    single: mockSingle,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findCandidateByEmail", () => {
  it("returns the candidate id when a match exists", async () => {
    mockSingle.mockResolvedValue(chainReturn({ id: "candidate-1" }));

    const result = await findCandidateByEmail("alice@example.com");

    expect(result).toEqual({ id: "candidate-1" });
    expect(mockFrom).toHaveBeenCalledWith("candidates");
    expect(mockSelect).toHaveBeenCalledWith("id");
    expect(mockEq).toHaveBeenCalledWith("email", "alice@example.com");
  });

  it("returns null when no match is found", async () => {
    mockSingle.mockResolvedValue(chainError("No rows found"));

    const result = await findCandidateByEmail("nobody@example.com");

    expect(result).toBeNull();
  });
});

describe("findCandidateByPhone", () => {
  it("returns the candidate id when a match exists", async () => {
    mockSingle.mockResolvedValue(chainReturn({ id: "candidate-2" }));

    const result = await findCandidateByPhone("+1-555-1234");

    expect(result).toEqual({ id: "candidate-2" });
    expect(mockEq).toHaveBeenCalledWith("phone", "+1-555-1234");
  });

  it("returns null when no match is found", async () => {
    mockSingle.mockResolvedValue(chainError("No rows found"));

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
  it("re-points applications and soft-deletes the source candidate", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: updateMock,
      delete: mockDelete,
    }));

    await mergeCandidatesTx("source-c", "target-c");

    // First update: applications
    expect(updateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ candidate_id: "target-c" }),
    );

    // Second update: candidates soft-delete
    expect(updateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
  });

  it("throws when re-pointing applications fails", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: "fk violation" } }),
    });

    mockFrom.mockImplementation(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: updateMock,
      delete: mockDelete,
    }));

    await expect(mergeCandidatesTx("s", "t")).rejects.toThrow("fk violation");
  });
});
