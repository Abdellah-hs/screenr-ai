import { describe, expect, it } from "vitest";
import {
  buildActivityTimeline,
  transitionPolarity,
  type TransitionRow,
} from "./transition-timeline";

let seq = 0;

function row(overrides: Partial<TransitionRow> = {}): TransitionRow {
  seq += 1;
  return {
    id: `t-${seq}`,
    from_state: "new",
    to_state: "screening_scored",
    actor: "system",
    rationale: null,
    disposition_code: null,
    disposition_description: null,
    created_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-08-10T09:00:00.000Z");

describe("transitionPolarity", () => {
  it("treats states that close or reject the application as rejecting", () => {
    for (const state of [
      "rejected",
      "archived",
      "screening_expired",
      "interview_expired",
      "interview_no_show",
      "processing_failed",
    ] as const) {
      expect(transitionPolarity(state)).toBe("reject");
    }
  });

  it("treats states that move the application forward as advancing", () => {
    for (const state of [
      "screening_approved",
      "screening_sent",
      "interview_invited",
      "reference_check",
      "manager_review",
      "final_interview_scheduling",
      "hired",
    ] as const) {
      expect(transitionPolarity(state)).toBe("advance");
    }
  });

  /**
   * Evidence-recording states take no side. Without this, every recruiter
   * action following a score would look like a reversal of it.
   */
  it("treats evidence-recording states as neutral", () => {
    for (const state of [
      "new",
      "screening_completed",
      "screening_scored",
      "interview_completed",
      "interview_scored",
    ] as const) {
      expect(transitionPolarity(state)).toBe("neutral");
    }
  });

  /**
   * The pipeline asking a human to decide is not itself a decision, so the
   * answer to it can never be an override of it. This is the single most
   * likely false positive in the whole feature: under HITL every approval and
   * every rejection follows `screening_review_pending`.
   */
  it("treats a request for human review as neutral, not as a decision", () => {
    expect(transitionPolarity("screening_review_pending")).toBe("neutral");
  });
});

describe("buildActivityTimeline — shape", () => {
  it("returns an empty timeline with no dwell time for an empty log", () => {
    // Zero hours would claim we observed the application sitting for no time,
    // which is a different statement from having observed nothing.
    expect(buildActivityTimeline([], NOW)).toEqual({
      entries: [],
      hoursInCurrentState: null,
    });
  });

  it("orders oldest-first regardless of the order rows arrive in", () => {
    const later = row({ id: "second", created_at: "2026-08-02T09:00:00.000Z" });
    const earlier = row({ id: "first", created_at: "2026-08-01T09:00:00.000Z" });

    const { entries } = buildActivityTimeline([later, earlier], NOW);

    expect(entries.map((e) => e.id)).toEqual(["first", "second"]);
  });

  it("carries the disposition through when one was recorded", () => {
    const rows = [
      row({
        to_state: "rejected",
        disposition_code: "LOW_SCORE",
        disposition_description: "Resume scored 31 against a threshold of 60",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[0].disposition).toEqual({
      code: "LOW_SCORE",
      description: "Resume scored 31 against a threshold of 60",
    });
  });

  it("reports no disposition for a mid-pipeline transition", () => {
    expect(buildActivityTimeline([row()], NOW).entries[0].disposition).toBeNull();
  });
});

describe("buildActivityTimeline — time in state", () => {
  it("measures each entry against the transition before it", () => {
    const rows = [
      row({ id: "a", created_at: "2026-08-01T09:00:00.000Z" }),
      row({ id: "b", created_at: "2026-08-01T15:00:00.000Z" }),
    ];

    const { entries } = buildActivityTimeline(rows, NOW);

    expect(entries[0].hoursInPreviousState).toBeNull();
    expect(entries[1].hoursInPreviousState).toBe(6);
  });

  it("measures the current state against now, not against the last transition", () => {
    const rows = [row({ created_at: "2026-08-09T09:00:00.000Z" })];

    expect(buildActivityTimeline(rows, NOW).hoursInCurrentState).toBe(24);
  });
});

describe("buildActivityTimeline — override detection", () => {
  /**
   * The load-bearing case for PRD 3.7.2, and the only direction the state
   * machine can actually produce: `rejected` is a dead end (`["archived"]`), so
   * an automated rejection can never be reversed. What happens instead is that
   * the pipeline advanced on a score and a person said no.
   */
  it("flags a recruiter rejection that reverses an automated advance", () => {
    const rows = [
      row({
        id: "auto",
        actor: "system",
        from_state: "new",
        to_state: "screening_approved",
        rationale: "Resume score 78 >= threshold 60",
        created_at: "2026-08-01T09:00:00.000Z",
      }),
      row({
        id: "human",
        actor: "recruiter",
        from_state: "screening_approved",
        to_state: "rejected",
        rationale: "Score is carried by a stack we are moving off.",
        created_at: "2026-08-02T09:00:00.000Z",
      }),
    ];

    const { entries } = buildActivityTimeline(rows, NOW);

    expect(entries[0].overrides).toBeNull();
    expect(entries[1].overrides).toEqual({
      toState: "screening_approved",
      rationale: "Resume score 78 >= threshold 60",
      at: "2026-08-01T09:00:00.000Z",
    });
  });

  /**
   * The comparison is written symmetrically so it stays correct if the state
   * machine ever allows a rejection to be undone. Unreachable today, which is
   * exactly why it needs a test rather than an assumption.
   */
  it("flags a recruiter advance that reverses an automated rejection", () => {
    const rows = [
      row({
        id: "auto",
        actor: "system",
        to_state: "rejected",
        rationale: "score 41 < threshold 60",
        created_at: "2026-08-01T09:00:00.000Z",
      }),
      row({
        id: "human",
        actor: "recruiter",
        from_state: "rejected",
        to_state: "screening_approved",
        created_at: "2026-08-02T09:00:00.000Z",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[1].overrides?.toState).toBe(
      "rejected",
    );
  });

  /**
   * The normal case, and the one most likely to be miscounted: the pipeline
   * stopped at manager_review by design and the recruiter carried on. Same
   * direction, so nobody overrode anything.
   */
  it("does not flag a recruiter action that agrees with the automated decision", () => {
    const rows = [
      row({ id: "auto", actor: "system", to_state: "manager_review" }),
      row({
        id: "human",
        actor: "recruiter",
        from_state: "manager_review",
        to_state: "hired",
        created_at: "2026-08-02T09:00:00.000Z",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[1].overrides).toBeNull();
  });

  it("skips neutral evidence rows to find the decision actually reversed", () => {
    // The interview score landing between the decision and the reversal must
    // not be mistaken for the thing that was overridden.
    const rows = [
      row({
        id: "decision",
        actor: "system",
        to_state: "manager_review",
        rationale: "Interview score 88 — queued for the hiring manager",
        created_at: "2026-08-01T09:00:00.000Z",
      }),
      row({
        id: "evidence",
        actor: "system",
        to_state: "interview_scored",
        created_at: "2026-08-01T10:00:00.000Z",
      }),
      row({
        id: "human",
        actor: "recruiter",
        to_state: "rejected",
        created_at: "2026-08-02T09:00:00.000Z",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[2].overrides?.toState).toBe(
      "manager_review",
    );
  });

  /**
   * Under HITL every recruiter decision follows `screening_review_pending`.
   * If that counted as a decision, every single HITL rejection would be
   * mislabelled an override and the flag would mean nothing.
   */
  it("does not treat answering a HITL review request as an override", () => {
    const rows = [
      row({
        id: "asked",
        actor: "system",
        from_state: "new",
        to_state: "screening_review_pending",
        created_at: "2026-08-01T09:00:00.000Z",
      }),
      row({
        id: "human",
        actor: "recruiter",
        from_state: "screening_review_pending",
        to_state: "rejected",
        created_at: "2026-08-02T09:00:00.000Z",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[1].overrides).toBeNull();
  });

  it("does not flag a recruiter action with no automated decision behind it", () => {
    const rows = [
      row({ id: "human", actor: "recruiter", to_state: "screening_approved" }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[0].overrides).toBeNull();
  });

  it("never flags an automated transition as an override of another", () => {
    // Only a person can override; the pipeline reversing itself is a bug
    // report, not an override, and mislabelling it would corrupt the count.
    const rows = [
      row({ id: "a", actor: "system", to_state: "screening_approved" }),
      row({
        id: "b",
        actor: "system",
        to_state: "screening_expired",
        created_at: "2026-08-05T09:00:00.000Z",
      }),
    ];

    expect(
      buildActivityTimeline(rows, NOW).entries.every((e) => e.overrides === null),
    ).toBe(true);
  });

  /**
   * The manager ticked "I'm overriding a passing result". Trust the explicit
   * statement over the inference, which cannot see a decision made before this
   * log began or one never written as a transition.
   */
  it("trusts an OVERRIDE_REJECTED disposition even with no automated decision logged", () => {
    const rows = [
      row({
        id: "human",
        actor: "recruiter",
        from_state: "manager_review",
        to_state: "rejected",
        disposition_code: "OVERRIDE_REJECTED",
        disposition_description: "Strong scores, but not what this team needs.",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[0].overrides).toEqual({
      toState: "manager_review",
      rationale: null,
      at: "2026-08-01T09:00:00.000Z",
    });
  });

  it("prefers the logged automated decision over the disposition inference", () => {
    const rows = [
      row({
        id: "auto",
        actor: "system",
        to_state: "manager_review",
        rationale: "Interview score 88 — queued for the hiring manager",
        created_at: "2026-08-01T09:00:00.000Z",
      }),
      row({
        id: "human",
        actor: "recruiter",
        from_state: "manager_review",
        to_state: "rejected",
        disposition_code: "OVERRIDE_REJECTED",
        created_at: "2026-08-02T09:00:00.000Z",
      }),
    ];

    expect(buildActivityTimeline(rows, NOW).entries[1].overrides?.rationale).toBe(
      "Interview score 88 — queued for the hiring manager",
    );
  });
});
