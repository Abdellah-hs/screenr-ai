import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchApp, mockFetchQuestions } = vi.hoisted(() => ({
  mockFetchApp: vi.fn(),
  mockFetchQuestions: vi.fn(),
}));

vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationForResponse: mockFetchApp,
}));
vi.mock("@/lib/data/screening-questions", () => ({
  fetchScreeningQuestionsByCampaignId: mockFetchQuestions,
}));

import { composeScreeningInstructions } from "./instructions";
import type { SupabaseDb } from "@/lib/supabase/types";

const DB = { __brand: "admin-client" } as unknown as SupabaseDb;
const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

const APP = {
  application_id: APP_ID,
  campaign_id: "camp-1",
  campaign_title: "Senior Backend Engineer",
  campaign_status: "active" as const,
  candidate_first_name: "Ada",
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

const QUESTIONS = [
  { id: "q1", prompt: "Describe a scaling problem you solved." },
  { id: "q2", prompt: "How do you decide what to test?" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchApp.mockResolvedValue(APP);
  mockFetchQuestions.mockResolvedValue(QUESTIONS);
});

describe("composeScreeningInstructions", () => {
  it("builds the topic guide from the campaign's questions", async () => {
    const out = (await composeScreeningInstructions(APP_ID, DB))?.instructions;

    expect(out).toContain("Describe a scaling problem you solved.");
    expect(out).toContain("How do you decide what to test?");
    expect(out).toContain("Senior Backend Engineer");
  });

  /**
   * The résumé anchor is mitigation #3 in docs/voice-screening.md, and it was
   * dead until this composer existed: `buildScreeningInstructions` had taken a
   * `resumeSummary` since #82, but the screening path read campaign framing
   * alone and never passed one.
   */
  it("anchors a probe to the candidate's actual background", async () => {
    const out = (await composeScreeningInstructions(APP_ID, DB))?.instructions;

    expect(out).toContain("Anchor at least one question");
    expect(out).toContain("Stripe");
  });

  it("greets the candidate by their first name", async () => {
    const out = (await composeScreeningInstructions(APP_ID, DB))?.instructions;

    expect(out).toContain("by name (Ada)");
  });

  it("still composes for a candidate whose résumé was never ingested", async () => {
    mockFetchApp.mockResolvedValue({ ...APP, resume: null });

    const out = (await composeScreeningInstructions(APP_ID, DB))?.instructions;

    expect(out).toContain("Describe a scaling problem you solved.");
    expect(out).not.toContain("Anchor at least one question");
  });

  it("reads through the injected client, never a cookie-scoped one", async () => {
    await composeScreeningInstructions(APP_ID, DB);

    expect(mockFetchApp).toHaveBeenCalledWith(APP_ID, DB);
    expect(mockFetchQuestions).toHaveBeenCalledWith("camp-1", DB);
  });

  /**
   * The default has to stay "inline", because a worker deployed before runtime
   * topic control does not ask for the tool protocol and cannot call a tool.
   * Shipping the app first must never hand it an interviewer with no topics.
   */
  it("inlines the topic guide and offers no fallback by default", async () => {
    const out = await composeScreeningInstructions(APP_ID, DB);

    expect(out?.instructions).toContain("Describe a scaling problem you solved.");
    expect(out?.topicFallback).toBeNull();
  });

  it("withholds the topics and hands over a fallback when asked to defer", async () => {
    const out = await composeScreeningInstructions(APP_ID, DB, true);

    expect(out?.instructions).not.toContain("Describe a scaling problem you solved.");
    expect(out?.topicFallback).toContain("Describe a scaling problem you solved.");
  });

  it("returns null for an unknown application", async () => {
    mockFetchApp.mockResolvedValue(null);

    await expect(composeScreeningInstructions(APP_ID, DB)).resolves.toBeNull();
  });

  /**
   * A no-question campaign must not yield an interviewer with an empty topic
   * guide: it would hold a five-minute conversation that evidences no rubric
   * dimension, and every one of them would score 0. The caller 404s instead.
   */
  it("returns null when the campaign has no screening questions", async () => {
    mockFetchQuestions.mockResolvedValue([]);

    await expect(composeScreeningInstructions(APP_ID, DB)).resolves.toBeNull();
  });
});
