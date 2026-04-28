import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  generateScreeningCriteria,
  generateRubricDimensions,
  scoreResumeAgainstCriteria,
} from "./openai";

function aiResponse(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
  };
}

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mockCreate.mockReset();
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
    mockCreate.mockResolvedValueOnce(
      aiResponse({
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
    mockCreate.mockResolvedValueOnce(
      aiResponse({ criteria: [{ label: "X", weight: 1, is_mandatory: true }] }),
    );

    await generateScreeningCriteria("Hire a Rust systems engineer");

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Hire a Rust systems engineer");
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(generateScreeningCriteria("anything")).rejects.toThrow(
      "OPENAI_API_KEY is not configured",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws when the AI returns an empty criteria array", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse({ criteria: [] }));

    await expect(generateScreeningCriteria("desc")).rejects.toThrow(
      "OpenAI returned no criteria",
    );
  });

  it("throws when the AI returns an empty content string", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    await expect(generateScreeningCriteria("desc")).rejects.toThrow(
      "OpenAI returned an empty response",
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
    mockCreate.mockResolvedValueOnce(aiResponse(fullStagesPayload()));

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
    mockCreate.mockResolvedValueOnce(
      aiResponse({
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

  it("throws when the AI omits any of the three required stages", async () => {
    const payload = fullStagesPayload();
    delete (payload as Partial<typeof payload>).interview;
    mockCreate.mockResolvedValueOnce(aiResponse(payload));

    await expect(generateRubricDimensions("desc", "campaign-1")).rejects.toThrow(
      "OpenAI returned no dimensions for interview stage",
    );
  });

  it("throws when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(generateRubricDimensions("desc", "campaign-1")).rejects.toThrow(
      "OPENAI_API_KEY is not configured",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("scoreResumeAgainstCriteria", () => {
  const sampleCriteria = [
    { id: "sc-1", label: "React", weight: 0.6, is_mandatory: true },
    { id: "sc-2", label: "Tests", weight: 0.4, is_mandatory: false },
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
    mockCreate.mockResolvedValueOnce(aiResponse(scorePayload({ overall_score: 142 })));

    const high = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(high.overall_score).toBe(100);

    mockCreate.mockResolvedValueOnce(aiResponse(scorePayload({ overall_score: -30 })));

    const low = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(low.overall_score).toBe(0);
  });

  it("rounds non-integer overall_score to the nearest integer", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(scorePayload({ overall_score: 72.6 })));

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.overall_score).toBe(73);
  });

  it("clamps and rounds factor scores", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
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
    expect(result.factors.map((f) => f.score)).toEqual([100, 0, 47]);
  });

  it("derives the tier from the score when the AI returns an invalid tier", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(scorePayload({ tier: "lol-not-a-tier", overall_score: 80 })),
    );
    expect((await scoreResumeAgainstCriteria({}, sampleCriteria, "JD")).tier).toBe("strong");

    mockCreate.mockResolvedValueOnce(
      aiResponse(scorePayload({ tier: "lol-not-a-tier", overall_score: 60 })),
    );
    expect((await scoreResumeAgainstCriteria({}, sampleCriteria, "JD")).tier).toBe("moderate");

    mockCreate.mockResolvedValueOnce(
      aiResponse(scorePayload({ tier: "lol-not-a-tier", overall_score: 30 })),
    );
    expect((await scoreResumeAgainstCriteria({}, sampleCriteria, "JD")).tier).toBe("weak");

    mockCreate.mockResolvedValueOnce(
      aiResponse(scorePayload({ tier: "lol-not-a-tier", overall_score: 10 })),
    );
    expect((await scoreResumeAgainstCriteria({}, sampleCriteria, "JD")).tier).toBe("no_match");
  });

  it("preserves a valid tier returned by the AI even if it disagrees with the score", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(scorePayload({ tier: "weak", overall_score: 90 })),
    );

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.tier).toBe("weak");
  });

  it("falls back to a default rationale when the AI omits one", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(scorePayload({ rationale: "" })));

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.rationale).toBe("No rationale provided.");
  });

  it("returns an empty factors array when the AI omits factors", async () => {
    const { factors: _omitted, ...withoutFactors } = scorePayload();
    void _omitted;
    mockCreate.mockResolvedValueOnce(aiResponse(withoutFactors));

    const result = await scoreResumeAgainstCriteria({}, sampleCriteria, "JD");
    expect(result.factors).toEqual([]);
  });

  it("forwards the job description, criteria, and parsed resume into the prompt", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(scorePayload()));

    await scoreResumeAgainstCriteria(
      { skills: ["React", "TS"] },
      sampleCriteria,
      "Frontend role at Acme",
    );

    const call = mockCreate.mock.calls[0][0];
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
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws when the AI returns an empty content string", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    await expect(
      scoreResumeAgainstCriteria({}, sampleCriteria, "JD"),
    ).rejects.toThrow("OpenAI returned an empty response for resume scoring");
  });
});
