import { describe, it, expect } from "vitest";
import { buildResumeEvidenceCacheKey, sha256Hex, type ResumeEvidenceCacheKeyInput } from "./cache-key";
import type { ResumeCriterion } from "./criteria";

const CRITERIA: ResumeCriterion[] = [
  { id: "c1", label: "TypeScript", priority: "must_have" },
  { id: "c2", label: "Testing", priority: "nice_to_have" },
];

function input(overrides: Partial<ResumeEvidenceCacheKeyInput> = {}): ResumeEvidenceCacheKeyInput {
  return {
    normalizedResumeText: "Built APIs using TypeScript.",
    criteria: CRITERIA,
    rubricVersion: 3,
    promptVersion: "v3_resume_evidence",
    model: "gpt-4o-mini",
    scoringRulesVersion: "v1_must_have_gate",
    ...overrides,
  };
}

describe("sha256Hex", () => {
  it("produces a stable 64-character digest", () => {
    const digest = sha256Hex("resume");
    expect(digest).toHaveLength(64);
    expect(digest).toBe(sha256Hex("resume"));
  });
});

describe("buildResumeEvidenceCacheKey", () => {
  it("is stable across calls with identical inputs", () => {
    expect(buildResumeEvidenceCacheKey(input())).toBe(buildResumeEvidenceCacheKey(input()));
  });

  it("ignores criterion ids, which change when a rubric is re-saved", () => {
    const renumbered = CRITERIA.map((c, i) => ({ ...c, id: `fresh-uuid-${i}` }));

    expect(buildResumeEvidenceCacheKey(input({ criteria: renumbered }))).toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("changes when a criterion flips from must-have to nice-to-have", () => {
    const flipped: ResumeCriterion[] = [
      { id: "c1", label: "TypeScript", priority: "nice_to_have" },
      { id: "c2", label: "Testing", priority: "nice_to_have" },
    ];

    expect(buildResumeEvidenceCacheKey(input({ criteria: flipped }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("changes when the resume text changes", () => {
    expect(
      buildResumeEvidenceCacheKey(input({ normalizedResumeText: "Built APIs using Go." })),
    ).not.toBe(buildResumeEvidenceCacheKey(input()));
  });

  it("changes when a criterion is added", () => {
    expect(
      buildResumeEvidenceCacheKey({
        ...input(),
        criteria: [...CRITERIA, { id: "c3", label: "Docker", priority: "nice_to_have" }],
      }),
    ).not.toBe(buildResumeEvidenceCacheKey(input()));
  });

  it("changes when criteria are reordered, because evidence is order-aligned", () => {
    expect(buildResumeEvidenceCacheKey(input({ criteria: [...CRITERIA].reverse() }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("changes when the rubric version changes", () => {
    expect(buildResumeEvidenceCacheKey(input({ rubricVersion: 4 }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("changes when the extraction prompt version changes", () => {
    expect(buildResumeEvidenceCacheKey(input({ promptVersion: "v4_resume_evidence" }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("changes when the model changes", () => {
    expect(buildResumeEvidenceCacheKey(input({ model: "gpt-5" }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("changes when the deterministic scoring rules change", () => {
    expect(buildResumeEvidenceCacheKey(input({ scoringRulesVersion: "v2_gate" }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });

  it("does not collide when a label boundary shifts between two criteria", () => {
    // "Type" + "ScriptTesting" must not hash the same as "TypeScript" + "Testing".
    const shifted: ResumeCriterion[] = [
      { id: "c1", label: "Type", priority: "must_have" },
      { id: "c2", label: "ScriptTesting", priority: "nice_to_have" },
    ];

    expect(buildResumeEvidenceCacheKey(input({ criteria: shifted }))).not.toBe(
      buildResumeEvidenceCacheKey(input()),
    );
  });
});
