import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchContext } = vi.hoisted(() => ({ mockFetchContext: vi.fn() }));

vi.mock("@/lib/data/candidates", () => ({
  fetchInterviewContextByApplicationId: mockFetchContext,
}));

import { composeInterviewInstructions, toInterviewResume } from "./instructions";
import type { SupabaseDb } from "@/lib/supabase/types";

const DB = { __brand: "admin-client" } as unknown as SupabaseDb;
const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

const CTX = {
  application_id: APP_ID,
  campaign_id: "camp-1",
  campaign_title: "Senior Backend Engineer",
  campaign_status: "active" as const,
  candidate_first_name: "Ada",
  candidate_last_name: "Lovelace",
  interview_persona: "neutral" as const,
  resume: {
    document_type: "cv" as const,
    first_name: "Ada",
    last_name: "Lovelace",
    headline: "Backend Engineer",
    summary: null,
    email: null,
    phone: null,
    location: null,
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
    skills: ["Go", "Kubernetes"],
    languages: [],
    interests: [],
    certifications: [],
    experience: [
      { company: "Stripe", title: "Staff Engineer", duration: "2021", description: "Ledger" },
    ],
    education: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchContext.mockResolvedValue(CTX);
});

describe("composeInterviewInstructions", () => {
  it("grounds the interview in the job title and the real résumé", async () => {
    const out = await composeInterviewInstructions(APP_ID, DB);

    expect(out).toContain("Senior Backend Engineer");
    expect(out).toContain("Stripe");
  });

  /**
   * Moved here from the action's tests when the instructions stopped travelling
   * in room metadata. The regression it guards is unchanged: the campaign's
   * persona was stored and displayed but never reached the interviewer, so a
   * recruiter who picked "Pressure" got a neutral interview and a stored
   * setting that misdescribed it.
   */
  it("carries the campaign's configured persona through to the interviewer", async () => {
    mockFetchContext.mockResolvedValue({ ...CTX, interview_persona: "pressure" });

    const out = await composeInterviewInstructions(APP_ID, DB);

    expect(out).toContain("PRESSURE");
    expect(out?.toLowerCase()).toContain("push back");
  });

  it("leaves a default campaign's interview neutral", async () => {
    const out = await composeInterviewInstructions(APP_ID, DB);

    expect(out).not.toContain("Your interviewing stance");
  });

  it("reads through the injected client, never a cookie-scoped one", async () => {
    await composeInterviewInstructions(APP_ID, DB);

    expect(mockFetchContext).toHaveBeenCalledWith(APP_ID, DB);
  });

  it("returns null for an unknown application so the route can 404", async () => {
    mockFetchContext.mockResolvedValue(null);

    await expect(composeInterviewInstructions(APP_ID, DB)).resolves.toBeNull();
  });
});

describe("toInterviewResume", () => {
  it("prefers the curated candidate name over whatever the parser read", async () => {
    const resume = toInterviewResume({
      ...CTX,
      candidate_first_name: "Ada",
      candidate_last_name: "King",
      resume: { ...CTX.resume, first_name: "A.", last_name: "Lovelace" },
    });

    expect(resume?.fullName).toBe("Ada King");
  });

  it("falls back to the résumé's own name when the candidate row has none", async () => {
    const resume = toInterviewResume({
      ...CTX,
      candidate_first_name: null,
      candidate_last_name: null,
    });

    expect(resume?.fullName).toBe("Ada Lovelace");
  });

  it("still yields the name when there is no résumé at all", async () => {
    const resume = toInterviewResume({ ...CTX, resume: null });

    expect(resume).toEqual({ fullName: "Ada Lovelace" });
  });
});
