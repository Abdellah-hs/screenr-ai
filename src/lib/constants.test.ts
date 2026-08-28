import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  APPLICATION_STATE_TRANSITIONS,
  APPLICATION_STAGE_BUCKET,
  toCandidateStage,
  pipelineDisplayScore,
  requiresDisposition,
  DISPOSITION_CODES,
  DISPOSITION_LABELS,
  SCREENING_ANSWER_BUDGET_MS,
  SCREENING_CALL_BACKSTOP_MINUTES,
  SCREENING_WRAP_UP_RESERVE_MS,
  screeningCallEstimateMinutes,
  TIER_COLORS,
  TIER_LABELS,
  IN_PLAY_CANDIDATE_STAGES,
  TERMINAL_CANDIDATE_STAGES,
  inPlayCandidateCount,
  type ApplicationState,
  type CandidateScore,
  type CandidateStage,
} from "./constants";
import { Constants } from "@/types/database.types";

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
  "interview_expired",
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
      // Deprecated slot-booking entry state: its inbound edge was cut when
      // scheduling moved to the final interview. Key kept for in-flight rows.
      if (state === "interview_scheduling") continue;
      expect(reachable, `no inbound transition into ${state}`).toContain(state);
    }
  });

  /**
   * Archiving became reversible in #144 (PRD 3.12.4 requires a manager can
   * bring someone back), so `archived` is no longer a dead end. The property
   * that replaces "terminal" is symmetry: un-archiving is an UNDO, so the only
   * exits are the states that could have archived in the first place. Without
   * this, `archived` would quietly become a shortcut into any state.
   */
  it("keeps archived out of the active pipeline buckets", () => {
    // The overview funnel sums applied+screening+interview+final_interview, so
    // an archived candidate leaves the active count purely by bucketing —
    // no extra filter needed, and none to forget.
    expect(toCandidateStage("archived")).toBe("rejected");
  });

  it("lets archived return only to states that can archive", () => {
    const canArchive = Object.entries(APPLICATION_STATE_TRANSITIONS)
      .filter(([state, targets]) => state !== "archived" && targets.includes("archived"))
      .map(([state]) => state)
      .sort();

    expect([...APPLICATION_STATE_TRANSITIONS.archived].sort()).toEqual(canArchive);
  });

  it("routes the on-demand interview invite to completed or expired only", () => {
    expect(APPLICATION_STATE_TRANSITIONS.interview_invited).toEqual([
      "interview_completed",
      "interview_expired",
      "rejected",
    ]);
  });

  it("gives an invited candidate no shortcut past the interview into manager review", () => {
    expect(APPLICATION_STATE_TRANSITIONS.interview_invited).not.toContain(
      "manager_review",
    );
  });

  it("routes a scored screening only to the AI interview or rejection — never slot booking", () => {
    expect(APPLICATION_STATE_TRANSITIONS.screening_scored).toEqual([
      "interview_invited",
      "rejected",
    ]);
  });

  it("keeps slot booking for the final interview stage (after manager review)", () => {
    expect(APPLICATION_STATE_TRANSITIONS.manager_review).toContain(
      "final_interview_scheduling",
    );
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
      "interview_invited",
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
      "interview_expired",
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

  it.each(FAILURE_STATES.filter((state) => state !== "processing_failed"))(
    "makes %s an observable dead-end whose only exit is archived",
    (state) => {
      expect(APPLICATION_STATE_TRANSITIONS[state]).toEqual(["archived"]);
    },
  );

  // The exception, and it is the only one: `processing_failed` records OUR
  // failure to read a CV, not a fact about the candidate. When the outage
  // clears it goes back to `new` and is scored like any other application.
  it("lets processing_failed recover to new, and nowhere else but archived", () => {
    expect(APPLICATION_STATE_TRANSITIONS.processing_failed).toEqual(["new", "archived"]);
  });

  // A repair must not double as a shortcut past the rule that decides where a
  // scored CV goes.
  it("does not let a recovery skip straight into a decided state", () => {
    for (const target of APPLICATION_STATE_TRANSITIONS.processing_failed) {
      expect(["screening_approved", "screening_review_pending", "rejected"]).not.toContain(target);
    }
  });

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
      evaluation: null,
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

describe("screening tier display config", () => {
  // The DB enum is the source of truth for tier values. If a migration adds a
  // tier and these maps aren't updated, the UI falls back to rendering the raw
  // enum value (e.g. "No_match") with no badge colors — the bug this guards.
  const DB_TIERS = Constants.public.Enums.screening_tier_enum;

  it.each(DB_TIERS)("gives %s a human-readable label", (tier) => {
    const label = TIER_LABELS[tier];

    expect(label).toBeDefined();
    expect(label).not.toMatch(/_/);
  });

  it.each(DB_TIERS)("gives %s badge colors", (tier) => {
    expect(TIER_COLORS[tier]).toBeDefined();
  });

  it("calls the middle tier Potential Match, not Moderate", () => {
    // PRD language. `moderate` reads as a verdict on the candidate, where the
    // tier is only a band derived from a score. The DB enum value is unchanged.
    expect(TIER_LABELS.moderate).toBe("Potential Match");
  });

  it("is the only place a tier label is written", () => {
    // The real failure mode this rename exposed: talent-pool-table prettified
    // the raw enum itself (`tier.charAt(0).toUpperCase() + ...`), so it kept
    // rendering "Moderate" while every other surface changed. A component that
    // derives its own label silently opts out of the next rename too.
    //
    // Reading TIER_LABELS and delegating to the score block that reads it are
    // both fine — the invariant is that nobody builds a label from the enum.
    const sources = [
      "src/components/candidates/talent-pool-table.tsx",
      "src/components/campaigns/candidate-table.tsx",
      "src/components/ui/score-block.tsx",
    ];

    for (const file of sources) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/tier\.charAt\(0\)\.toUpperCase\(\)/);
      expect(
        src.includes("TIER_LABELS") || src.includes("ScoreInline"),
        `${file} must read TIER_LABELS or delegate to a component that does`,
      ).toBe(true);
    }
  });
});

describe("disposition codes", () => {
  it("requires a disposition on the states that close without saying why", () => {
    expect(requiresDisposition("rejected")).toBe(true);
    expect(requiresDisposition("archived")).toBe(true);
  });

  it("does not require a disposition on a hire", () => {
    expect(requiresDisposition("hired")).toBe(false);
  });

  it("does not require a disposition on a self-describing failure state", () => {
    // These close an application too, but the state name already carries the
    // reason — `screening_expired` cannot have closed for any cause other
    // than expiry. Demanding a code here would collect a field whose value is
    // determined by the column next to it. Callers may still pass one.
    const selfDescribing: ApplicationState[] = [
      "screening_expired",
      "interview_expired",
      "interview_no_show",
      "processing_failed",
    ];

    expect(selfDescribing.some(requiresDisposition)).toBe(false);
  });

  it("does not require a disposition on a mid-pipeline transition", () => {
    expect(requiresDisposition("screening_sent")).toBe(false);
    expect(requiresDisposition("manager_review")).toBe(false);
  });

  it.each(DISPOSITION_CODES)("gives %s a human-readable label", (code) => {
    const label = DISPOSITION_LABELS[code];

    expect(label).toBeDefined();
    expect(label).not.toMatch(/_/);
  });
});

describe("screening call pacing", () => {
  /**
   * The 2026-08-24 change: a screening call has no clock the candidate races.
   * Each ANSWER gets its own budget and the call ends when its topics are
   * covered, so the estimate below is copy — it is quoted in the invitation
   * email and on the pre-call screen and enforced nowhere.
   *
   * This is the assertion that would fail if anyone re-derived a timer from
   * it, which is exactly how the old five-minute guillotine came about: one
   * function fed the copy AND the hard cut, so "about 5 minutes" was a promise
   * and a threat in the same sentence.
   */
  it("estimates a longer call for more topics, since a call now lasts as long as its topics", () => {
    expect(screeningCallEstimateMinutes(8)).toBeGreaterThan(
      screeningCallEstimateMinutes(3),
    );
  });

  it("never advertises a call shorter than the setup it asks of the candidate", () => {
    // Finding a quiet room and sorting out a microphone is not worth doing for
    // three minutes, however few topics there are.
    for (const count of [0, 1, 3]) {
      expect(screeningCallEstimateMinutes(count)).toBeGreaterThanOrEqual(5);
    }
  });

  it("is monotonic — one more topic never shortens the estimate", () => {
    for (let topics = 0; topics < 15; topics += 1) {
      expect(screeningCallEstimateMinutes(topics + 1)).toBeGreaterThanOrEqual(
        screeningCallEstimateMinutes(topics),
      );
    }
  });

  /**
   * The backstop is a failure bound, not a duration — it catches a dead worker
   * or an abandoned tab, both of which bill a Realtime session by the minute.
   * It has to sit above the worst case a well-behaved call can reach, or it
   * would start cutting real interviews and become the guillotine again.
   *
   * This replaced the old `MAX_SCREENING_CALL_MINUTES <=
   * INTERVIEW_DURATION_MINUTES` assertion, which compared two fixed lengths.
   * Screening no longer has a fixed length, so that comparison no longer has
   * two comparable things in it.
   */
  it("keeps the backstop above the longest call that could legitimately happen", () => {
    const topics = 8;
    // **One answer per topic, because that is the whole call now** (decision
    // 2026-08-27): follow-ups are gone, so a topic can draw exactly one minute
    // rather than up to three. The budget alone, because a budget is all there
    // is — the grace that used to sit on top of it was retired on 2026-08-25,
    // when zero started moving the call on whoever was talking.
    const worstCaseMs = topics * SCREENING_ANSWER_BUDGET_MS;

    expect(SCREENING_CALL_BACKSTOP_MINUTES * 60_000).toBeGreaterThan(worstCaseMs);
  });

  /**
   * The estimate is what the candidate is told; the backstop is what actually
   * stops the room. Quoting the backstop would frighten people off a call that
   * will really take seven minutes.
   */
  it("never quotes the backstop to the candidate", () => {
    for (const count of [0, 3, 5, 8, 15]) {
      expect(screeningCallEstimateMinutes(count)).toBeLessThan(
        SCREENING_CALL_BACKSTOP_MINUTES,
      );
    }
  });

  /**
   * The wrap-up reserve is carved out of the backstop, so it only matters on a
   * call that has already gone wrong. It still has to fit inside it.
   */
  it("leaves the wrap-up reserve inside the backstop", () => {
    expect(SCREENING_WRAP_UP_RESERVE_MS).toBeLessThan(
      SCREENING_CALL_BACKSTOP_MINUTES * 60_000,
    );
  });
});

describe("inPlayCandidateCount", () => {
  function buckets(over: Partial<Record<CandidateStage, number>> = {}) {
    return {
      applied: 0,
      screening: 0,
      interview: 0,
      final_interview: 0,
      hired: 0,
      rejected: 0,
      ...over,
    };
  }

  it("counts everybody still moving through the pipeline", () => {
    const total = inPlayCandidateCount(
      buckets({ applied: 4, screening: 3, interview: 2, final_interview: 1 }),
    );

    expect(total).toBe(10);
  });

  /**
   * The reason this is a function over a list rather than a written-out sum.
   * A sum fails SILENTLY when a stage is added — the new bucket is simply left
   * out, and the figure then disagrees with the total minus the outcome rows
   * printed on the same card, with nothing to say which one is wrong.
   */
  it("covers every non-terminal stage, so a new stage cannot be silently dropped", () => {
    const everyStageHasOne = buckets({
      applied: 1,
      screening: 1,
      interview: 1,
      final_interview: 1,
      hired: 1,
      rejected: 1,
    });

    expect(inPlayCandidateCount(everyStageHasOne)).toBe(IN_PLAY_CANDIDATE_STAGES.length);
  });

  it("excludes the outcomes — a hire is not somebody still in play", () => {
    expect(inPlayCandidateCount(buckets({ hired: 7, rejected: 9 }))).toBe(0);
  });

  it("and the two sets do not overlap", () => {
    for (const stage of TERMINAL_CANDIDATE_STAGES) {
      expect(IN_PLAY_CANDIDATE_STAGES).not.toContain(stage);
    }
  });
});
