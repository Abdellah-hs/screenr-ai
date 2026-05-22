import { describe, it, expect } from "vitest";
import {
  APPLICATION_STATE_TRANSITIONS,
  type ApplicationState,
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
