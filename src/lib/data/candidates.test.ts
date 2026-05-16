import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInsert = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

const mockFindCandidateByEmail = vi.fn();
const mockFindCandidateByPhone = vi.fn();
const mockFlagDuplicateCandidate = vi.fn();

vi.mock("@/lib/data/duplicate-flags", () => ({
  findCandidateByEmail: (...args: unknown[]) => mockFindCandidateByEmail(...args),
  findCandidateByPhone: (...args: unknown[]) => mockFindCandidateByPhone(...args),
  flagDuplicateCandidate: (...args: unknown[]) => mockFlagDuplicateCandidate(...args),
}));

import { upsertCandidate } from "./candidates";
import type { ParsedResumeData } from "@/lib/services/openai";

const baseResume: ParsedResumeData & { email: string } = {
  first_name: "Alice",
  last_name: "Smith",
  headline: null,
  summary: null,
  email: "alice@example.com",
  phone: "+1-555-1111",
  linkedin_url: "",
  portfolio_url: "",
  location: "NYC",
  skills: [],
  languages: [],
  interests: [],
  certifications: [],
  experience: [],
  education: [],
};

beforeEach(() => {
  vi.clearAllMocks();

  mockInsert.mockResolvedValue({ error: null });
  mockFrom.mockReturnValue({ insert: mockInsert });

  mockFindCandidateByEmail.mockResolvedValue(null);
  mockFindCandidateByPhone.mockResolvedValue(null);
  mockFlagDuplicateCandidate.mockResolvedValue("flag-1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertCandidate", () => {
  it("inserts a new candidate when no email or phone match exists", async () => {
    const id = await upsertCandidate(baseResume);

    expect(id).toBeTypeOf("string");
    expect(mockFrom).toHaveBeenCalledWith("candidates");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        first_name: "Alice",
      }),
    );
    expect(mockFlagDuplicateCandidate).not.toHaveBeenCalled();
  });

  it("flags a duplicate when an existing candidate has the same email", async () => {
    mockFindCandidateByEmail.mockResolvedValue({ id: "existing-1" });

    const id = await upsertCandidate(baseResume);

    expect(mockFlagDuplicateCandidate).toHaveBeenCalledWith({
      candidateId: id,
      matchedCandidateId: "existing-1",
      matchSignals: expect.objectContaining({
        email_match: true,
        matched_email: "alice@example.com",
      }),
    });
  });

  it("flags a duplicate when only the phone matches (different email)", async () => {
    mockFindCandidateByPhone.mockResolvedValue({ id: "existing-2" });

    const id = await upsertCandidate(baseResume);

    expect(mockFlagDuplicateCandidate).toHaveBeenCalledWith({
      candidateId: id,
      matchedCandidateId: "existing-2",
      matchSignals: expect.objectContaining({
        phone_match: true,
        matched_phone: "+1-555-1111",
      }),
    });
  });

  it("does not look up phone when the resume has no phone", async () => {
    const noPhoneResume: ParsedResumeData & { email: string } = { ...baseResume, phone: "" };

    await upsertCandidate(noPhoneResume);

    expect(mockFindCandidateByPhone).not.toHaveBeenCalled();
    expect(mockFlagDuplicateCandidate).not.toHaveBeenCalled();
  });

  it("propagates insert errors", async () => {
    mockInsert.mockResolvedValue({ error: { message: "unique violation" } });

    await expect(upsertCandidate(baseResume)).rejects.toMatchObject({
      message: "unique violation",
    });
  });
});
