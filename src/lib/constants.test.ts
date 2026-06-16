import { describe, it, expect } from "vitest";
import {
  APPLICATION_STATE_TRANSITIONS,
  APPLICATION_STAGE_BUCKET,
  toCandidateStage,
  pipelineDisplayScore,
  type ApplicationState,
  type CandidateScore,
  type CandidateStage,
} from "./constants";

const ALL_STATES = Object.keys(
  APPLICATION_STATE_TRANSITIONS,
) as ApplicationState[];

// Retired by issue #28 — these legacy values were migrated to canonical
// names (`screening`/`screening_q` → `screening_approved`, `interview` →
// `interview_completed`) and dropped from `candidate_stage_enum`.
const LEGACY_STATES = ["screening", "screening_q", "interview"];

// The explicit failure states added by issue #32 — every silent-failure
// path CLAUDE.md flagged now has an observable terminal state.
const FAILURE_STATES: ApplicationState[] = [
  "screening_expired",
  "interview_no_show",
  "processing_failed",
];

describe("APPLICATION_STATE_TRANSITIONS", () => {
  it("contains no legacy stage value as a key", () => {
    for (const legacy of LEGACY_STATES) {
      expect(ALL_STATES).not.toContain(legacy);
    }
  });

  it("never lists a legacy stage value as a transition target", () => {
    for (const [from, targets] of Object.entries(APPLICATION_STATE_TRANSITIONS)) {
      for (const legacy of LEGACY_STATES) {
        expect(targets, `${from} → ${legacy}`).not.toContain(legacy);
      }
    }
  });

  it("only lists known states as transition targets (no dangling targets)", () => {
    const known = new Set<string>(ALL_STATES);
    for (const [from, targets] of Object.entries(APPLICATION_STATE_TRANSITIONS)) {
      for (const target of targets) {
        expect(known, `unknown target: ${from} → ${target}`).toContain(target);
      }
    }
  });

  it("makes every non-entry state reachable via at least one inbound transition", () => {
    const reachable = new Set<string>();
    for (const targets of Object.values(APPLICATION_STATE_TRANSITIONS)) {
      for (const target of targets) reachable.add(target);
    }
    for (const state of ALL_STATES) {
      if (state === "new") continue; // entry state — no inbound transition expected
      expect(reachable, `no inbound transition into ${state}`).toContain(state);
    }
  });

  it("keeps archived a terminal state with no outbound transitions", () => {
    expect(APPLICATION_STATE_TRANSITIONS.archived).toEqual([]);
  });
});

describe("APPLICATION_STAGE_BUCKET / toCandidateStage", () => {
  const VALID_BUCKETS = new Set<CandidateStage>([
    "applied",
    "screening",
    "interview",
    "final_interview",
    "hired",
    "rejected",
  ]);

  it("maps every application state to a coarse bucket (exhaustive)", () => {
    for (const state of ALL_STATES) {
      expect(
        APPLICATION_STAGE_BUCKET[state],
        `unmapped state: ${state}`,
      ).toBeDefined();
    }
  });

  it("only ever maps to one of the six valid CandidateStage buckets", () => {
    for (const state of ALL_STATES) {
      expect(
        VALID_BUCKETS.has(APPLICATION_STAGE_BUCKET[state]),
        `${state} → ${APPLICATION_STAGE_BUCKET[state]} is not a valid bucket`,
      ).toBe(true);
    }
  });

  it("keeps an approved candidate visible under Screening (the reported bug)", () => {
    expect(toCandidateStage("screening_approved")).toBe("screening");
  });

  it("keeps every screening-phase state under Screening", () => {
    for (const state of [
      "screening_approved",
      "screening_sent",
      "screening_completed",
      "screening_scored",
    ] as ApplicationState[]) {
      expect(toCandidateStage(state)).toBe("screening");
    }
  });

  it("keeps a brand-new application and a pending review under Applied", () => {
    expect(toCandidateStage("new")).toBe("applied");
    expect(toCandidateStage("screening_review_pending")).toBe("applied");
  });

  it("groups every interview-track state under Interview", () => {
    for (const state of [
      "interview_scheduling",
      "interview_scheduled",
      "interview_completed",
      "interview_scored",
      "reference_check",
    ] as ApplicationState[]) {
      expect(toCandidateStage(state)).toBe("interview");
    }
  });

  it("treats terminal failure states as Rejected for the funnel", () => {
    for (const state of [
      "rejected",
      "screening_expired",
      "interview_no_show",
      "processing_failed",
      "archived",
    ] as ApplicationState[]) {
      expect(toCandidateStage(state)).toBe("rejected");
    }
  });

  it("falls back to Applied for an unknown status string", () => {
    expect(toCandidateStage("not_a_real_state")).toBe("applied");
  });
});

describe("failure states", () => {
  it.each(FAILURE_STATES)("defines %s as a state-machine key", (state) => {
    expect(ALL_STATES).toContain(state);
  });

  it.each(FAILURE_STATES)(
    "makes %s an observable dead-end whose only exit is archived",
    (state) => {
      expect(APPLICATION_STATE_TRANSITIONS[state]).toEqual(["archived"]);
    },
  );

  it("reaches screening_expired from screening_sent", () => {
    expect(APPLICATION_STATE_TRANSITIONS.screening_sent).toContain(
      "screening_expired",
    );
  });

  it("reaches interview_no_show from interview_scheduled", () => {
    expect(APPLICATION_STATE_TRANSITIONS.interview_scheduled).toContain(
      "interview_no_show",
    );
  });

  it("reaches processing_failed from at least one state", () => {
    const sources = Object.entries(APPLICATION_STATE_TRANSITIONS).filter(
      ([, targets]) => targets.includes("processing_failed"),
    );
    expect(sources.length).toBeGreaterThan(0);
  });
});

describe("pipelineDisplayScore", () => {
  function score(stage: CandidateScore["stage"], overall: number): CandidateScore {
    return {
      stage,
      overall,
      ai_summary: "",
      factors: [],
      scored_at: "2026-06-16T00:00:00.000Z",
      rubric_version: null,
      current_rubric_version: null,
    };
  }

  it("returns the current stage's score when it exists", () => {
    const result = pipelineDisplayScore({
      stage: "screening",
      scores: [score("resume", 80), score("screening", 65)],
    });

    expect(result?.stage).toBe("screening");
    expect(result?.overall).toBe(65);
  });

  it("returns null when the current stage isn't scored yet (no fallback)", () => {
    // In screening but only the resume has been scored — the cell stays blank;
    // we never surface the resume score in a screening row.
    const result = pipelineDisplayScore({
      stage: "screening",
      scores: [score("resume", 80)],
    });

    expect(result).toBeNull();
  });

  it("returns null for a terminal stage, which has no stage score of its own", () => {
    const result = pipelineDisplayScore({
      stage: "rejected",
      scores: [score("resume", 80), score("screening", 65)],
    });

    expect(result).toBeNull();
  });

  it("returns null when the candidate has no scores", () => {
    expect(pipelineDisplayScore({ stage: "applied", scores: [] })).toBeNull();
  });
});
