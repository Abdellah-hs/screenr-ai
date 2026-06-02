import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockParse } = vi.hoisted(() => ({
  mockParse: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { parse: mockParse } };
  },
}));

import {
  extractResumeData,
  generateScreeningCriteria,
  generateRubricDimensions,
  scoreResumeAgainstCriteria,
} from "./openai";

function parsedResponse(parsed: unknown, refusal: string | null = null) {
  return {
    choices: [{ message: { parsed, refusal } }],
  };
}

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mockParse.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
  }
});

describe("generateScreeningCriteria", () => {
  it("rounds weights to two decimal places and prefixes ids with sc-", async () => {
    mockParse.mockResolvedValueOnce(
      parsedResponse({
        criteria: [
          { label: "Senior React experience", weight: 0.33333, is_mandatory: true },
          { label: "TypeScript fluency", weight: 0.16666, is_mandatory: false },
        ],
      }),
    );

    const result = await generateScreeningCriteria("Senior React engineer role");

    expect(result).toHaveLength(2);
    expect(result[0].weight).toBe(0.33);
    expect(result[1].weight).toBe(0.17);
    expect(result[0].id).toMatch(/^sc-/);
    expect(result[1].id).toMatch(/^sc-/);
    expect(result[0].label).toBe("Senior React experience");
    expect(result[0].is_mandatory).toBe(true);
    expect(result[1].is_mandatory).toBe(false);
  });

  it("forwards the job description into the OpenAI prompt", async () => {
    mockParse.mockResolvedValueOnce(
      parsedResponse({ criteria: [{ label: "X", weight: 1, is_mandatory: true }] }),
    );

    await generateScreeningCriteria("Hire a Rust systems engineer");

    const call = mockParse.mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Hire a Rust systems engineer");
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(generateScreeningCriteria("anything")).rejects.toThrow(
      "OPENAI_API_KEY is not configured",
    );
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("throws when the AI returns an empty criteria array", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse({ criteria: [] }));

    await expect(generateScreeningCriteria("desc")).rejects.toThrow(
      "OpenAI returned no criteria",
    );
  });

  it("throws when the AI refuses the request", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, "I can't help with that"));

    await expect(generateScreeningCriteria("desc")).rejects.toThrow(
      "OpenAI refused screening criteria generation",
    );
  });

  it("throws when the AI returns no parsed payload", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, null));

    await expect(generateScreeningCriteria("desc")).rejects.toThrow(
      "OpenAI returned no parsed screening criteria",
    );
  });
});

describe("generateRubricDimensions", () => {
  function fullStagesPayload() {
    return {
      resume: [
        { name: "Years of experience", weight: 0.5, is_mandatory: true },
        { name: "Education", weight: 0.5, is_mandatory: false },
      ],
      screening_q: [
        { name: "Written clarity", weight: 0.6, is_mandatory: false },
        { name: "Technical depth", weight: 0.4, is_mandatory: true },
      ],
      interview: [
        { name: "Live problem solving", weight: 0.7, is_mandatory: true },
        { name: "Communication", weight: 0.3, is_mandatory: false },
      ],
    };
  }

  it("produces one rubric per stage in the canonical order, all active", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullStagesPayload()));

    const rubrics = await generateRubricDimensions("desc", "campaign-123");

    expect(rubrics.map((r) => r.stage)).toEqual(["resume", "screening_q", "interview"]);
    for (const r of rubrics) {
      expect(r.is_active).toBe(true);
      expect(r.campaign_id).toBe("campaign-123");
      expect(r.version).toBe(1);
      expect(r.archived_at).toBeNull();
      expect(r.id).toMatch(/^rub-/);
    }
  });

  it("rounds dimension weights and assigns sort_order in array order", async () => {
    mockParse.mockResolvedValueOnce(
      parsedResponse({
        ...fullStagesPayload(),
        resume: [
          { name: "Skill A", weight: 0.33333, is_mandatory: true },
          { name: "Skill B", weight: 0.66666, is_mandatory: false },
        ],
      }),
    );

    const [resumeRubric] = await generateRubricDimensions("desc", "campaign-1");

    expect(resumeRubric.dimensions[0].weight).toBe(0.33);
    expect(resumeRubric.dimensions[1].weight).toBe(0.67);
    expect(resumeRubric.dimensions[0].sort_order).toBe(0);
    expect(resumeRubric.dimensions[1].sort_order).toBe(1);
    expect(resumeRubric.dimensions[0].min_score).toBe(0);
    expect(resumeRubric.dimensions[0].max_score).toBe(100);
    expect(resumeRubric.dimensions[0].id).toMatch(/^dim-/);
  });

  it("throws when a stage array is empty", async () => {
    const payload = { ...fullStagesPayload(), interview: [] };
    mockParse.mockResolvedValueOnce(parsedResponse(payload));

    await expect(generateRubricDimensions("desc", "campaign-1")).rejects.toThrow(
      "OpenAI returned no dimensions for interview stage",
    );
  });

  it("throws when the AI refuses the request", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, "no can do"));

    await expect(generateRubricDimensions("desc", "campaign-1")).rejects.toThrow(
      "OpenAI refused rubric dimensions generation",
    );
  });

  it("throws when the AI returns no parsed payload", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, null));

    await expect(generateRubricDimensions("desc", "campaign-1")).rejects.toThrow(
      "OpenAI returned no parsed rubric dimensions",
    );
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(generateRubricDimensions("desc", "campaign-1")).rejects.toThrow(
      "OPENAI_API_KEY is not configured",
    );
    expect(mockParse).not.toHaveBeenCalled();
  });
});

describe("scoreResumeAgainstCriteria", () => {
  const sampleCriteria = [
    { id: "sc-1", label: "React", weight: 0.6, is_mandatory: true, min_score: 30 },
    { id: "sc-2", label: "Tests", weight: 0.4, is_mandatory: false, min_score: 0 },
  ];

  function scorePayload(overrides: Record<string, unknown> = {}) {
    return {
      overall_score: 80,
      tier: "strong",
      rationale: "Strong React background.",
      factors: [
        { name: "React", weight: 0.6, score: 90 },
        { name: "Tests", weight: 0.4, score: 65 },
      ],
      ...overrides,
    };
  }

  it("clamps overall_score to the 0..100 range", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(scorePayload({ overall_score: 142 })));

    const high = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(high.result.overall_score).toBe(100);

    mockParse.mockResolvedValueOnce(parsedResponse(scorePayload({ overall_score: -30 })));

    const low = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(low.result.overall_score).toBe(0);
  });

  it("rounds non-integer overall_score to the nearest integer", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(scorePayload({ overall_score: 72.6 })));

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.result.overall_score).toBe(73);
  });

  it("clamps and rounds factor scores", async () => {
    mockParse.mockResolvedValueOnce(
      parsedResponse(
        scorePayload({
          factors: [
            { name: "React", weight: 0.6, score: 200 },
            { name: "Tests", weight: 0.4, score: -10 },
            { name: "Edge", weight: 0, score: 47.4 },
          ],
        }),
      ),
    );

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.result.factors.map((f) => f.score)).toEqual([100, 0, 47]);
  });

  it("forwards the AI's tier verbatim, even when it disagrees with the score range", async () => {
    mockParse.mockResolvedValueOnce(
      parsedResponse(scorePayload({ tier: "weak", overall_score: 90 })),
    );

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.result.tier).toBe("weak");
  });

  it("falls back to a default rationale when the AI returns an empty string", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(scorePayload({ rationale: "" })));

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.result.rationale).toBe("No rationale provided.");
  });

  it("returns audit evidence (rawOutput, model, promptVersion) alongside the normalized result", async () => {
    const payload = scorePayload({ overall_score: 60 });
    mockParse.mockResolvedValueOnce(parsedResponse(payload));

    const evidence = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");

    expect(evidence.rawOutput).toBe(JSON.stringify(payload));
    expect(evidence.model).toBe("gpt-4o-mini");
    expect(evidence.promptVersion).toBe("v1_resume_scoring");
    expect(evidence.result.overall_score).toBe(60);
  });

  it("forwards the job description, criteria, and parsed resume into the prompt", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(scorePayload()));

    await scoreResumeAgainstCriteria(
      { skills: ["React", "TS"] },
      sampleCriteria,
      "Frontend role at Acme",
    );

    const call = mockParse.mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Frontend role at Acme");
    expect(userMessage.content).toContain("React");
    expect(userMessage.content).toContain("Tests");
    expect(userMessage.content).toContain("\"skills\"");
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      scoreResumeAgainstCriteria({}, sampleCriteria, "JD"),
    ).rejects.toThrow("OPENAI_API_KEY is not configured");
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("throws when the AI refuses the request", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, "I can't help with that"));

    await expect(
      scoreResumeAgainstCriteria({}, sampleCriteria, "JD"),
    ).rejects.toThrow("OpenAI refused resume scoring");
  });

  it("throws when the AI returns no parsed payload", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, null));

    await expect(
      scoreResumeAgainstCriteria({}, sampleCriteria, "JD"),
    ).rejects.toThrow("OpenAI returned no parsed resume score");
  });
});

describe("extractResumeData", () => {
  function fullResume(overrides: Record<string, unknown> = {}) {
    return {
      first_name: "Alice",
      last_name: "Smith",
      headline: "Senior Frontend Engineer",
      summary: "Frontend engineer focused on design systems.",
      email: "alice@example.com",
      phone: "+1-555-0100",
      location: "NYC",
      linkedin_url: "https://linkedin.com/in/alice",
      portfolio_url: "https://alice.dev",
      skills: ["React", "TypeScript"],
      languages: ["English", "Spanish"],
      interests: ["mountain biking"],
      certifications: ["AWS Solutions Architect"],
      experience: [
        {
          company: "Acme",
          title: "Senior Engineer",
          duration: "2022-2026",
          description: "Built things.",
        },
      ],
      education: [
        {
          institution: "State U",
          degree: "BSc CS",
          year_start: "2014",
          year_end: "2018",
        },
      ],
      ...overrides,
    };
  }

  it("returns parsed resume fields straight through when populated", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    const result = await extractResumeData("Alice resume text");

    expect(result.first_name).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
    expect(result.skills).toEqual(["React", "TypeScript"]);
    expect(result.experience[0].company).toBe("Acme");
  });

  it("round-trips the new headline / summary / languages / interests / certifications fields", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    const result = await extractResumeData("Alice resume text");

    expect(result.headline).toBe("Senior Frontend Engineer");
    expect(result.summary).toBe("Frontend engineer focused on design systems.");
    expect(result.languages).toEqual(["English", "Spanish"]);
    expect(result.interests).toEqual(["mountain biking"]);
    expect(result.certifications).toEqual(["AWS Solutions Architect"]);
  });

  it("instructs the model to keep skills, interests, and languages distinct", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    await extractResumeData("any resume");

    const call = mockParse.mock.calls[0][0];
    const systemMessage = call.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMessage.content).toContain("interests");
    expect(systemMessage.content).toContain("languages");
    expect(systemMessage.content).toContain("certifications");
  });

  it("preserves null for missing-but-tolerable fields instead of forcing strings", async () => {
    mockParse.mockResolvedValueOnce(
      parsedResponse(
        fullResume({
          email: null,
          phone: null,
          location: null,
          linkedin_url: null,
          portfolio_url: null,
        }),
      ),
    );

    const result = await extractResumeData("Sparse resume.");

    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.location).toBeNull();
    expect(result.linkedin_url).toBeNull();
    expect(result.portfolio_url).toBeNull();
  });

  it("instructs gpt-4o-mini and forwards the resume text in the user message", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    await extractResumeData("Distinctive marker XYZQ-123");

    const call = mockParse.mock.calls[0][0];
    expect(call.model).toBe("gpt-4o-mini");
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Distinctive marker XYZQ-123");
    expect(userMessage.content).toContain("---BEGIN RESUME---");
    expect(userMessage.content).toContain("---END RESUME---");
  });

  it("hardens the system prompt against prompt-injection from resume text", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    await extractResumeData("any resume");

    const call = mockParse.mock.calls[0][0];
    const systemMessage = call.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMessage.content.toLowerCase()).toContain("untrusted");
    expect(systemMessage.content.toLowerCase()).toContain("do not follow instructions");
  });

  it("strips null bytes and collapses runs of whitespace before sending", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    await extractResumeData("Foo  Bar     baz\n\n\n\nqux");

    const call = mockParse.mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).not.toContain(" ");
    expect(userMessage.content).toContain("Foo");
    expect(userMessage.content).toContain("Bar baz");
    expect(userMessage.content).not.toMatch(/\n{3,}/);
  });

  it("truncates the middle of an oversized resume but keeps head and tail", async () => {
    const head = "HEAD_SECTION_" + "a".repeat(60_000);
    const tail = "b".repeat(20_000) + "_TAIL_SECTION";
    const middle = "MIDDLE_GARBAGE_" + "x".repeat(30_000);
    mockParse.mockResolvedValueOnce(parsedResponse(fullResume()));

    await extractResumeData(head + middle + tail);

    const call = mockParse.mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("HEAD_SECTION_");
    expect(userMessage.content).toContain("_TAIL_SECTION");
    expect(userMessage.content).not.toContain("MIDDLE_GARBAGE_");
    expect(userMessage.content).toContain("truncated");
  });

  it("throws when the resume text is empty after normalization", async () => {
    await expect(extractResumeData("   \n\n   ")).rejects.toThrow(
      "Resume text is empty",
    );
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(extractResumeData("anything")).rejects.toThrow(
      "OPENAI_API_KEY is not configured",
    );
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("throws when the AI refuses the request", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, "I can't help with that"));

    await expect(extractResumeData("any resume")).rejects.toThrow(
      "OpenAI refused resume extraction",
    );
  });

  it("throws when the AI returns no parsed payload", async () => {
    mockParse.mockResolvedValueOnce(parsedResponse(null, null));

    await expect(extractResumeData("any resume")).rejects.toThrow(
      "OpenAI returned no parsed resume data",
    );
  });
});
