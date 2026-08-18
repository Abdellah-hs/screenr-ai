import { describe, expect, it } from "vitest";
import {
  ABANDONED_GRACE_MINUTES,
  isInterviewAbandoned,
  type OpenInterviewSession,
} from "./interview-expiry";
import { INTERVIEW_DURATION_MINUTES } from "@/lib/constants";

const NOW = new Date("2026-08-18T12:00:00.000Z");

/** Minutes before NOW, as an ISO string. */
function minutesAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60 * 1000).toISOString();
}

function session(overrides: Partial<OpenInterviewSession> = {}): OpenInterviewSession {
  return {
    status: "invited",
    expires_at: minutesAgo(60),
    started_at: null,
    ...overrides,
  };
}

describe("isInterviewAbandoned", () => {
  it("abandons an invitation the candidate never opened after its deadline", () => {
    expect(isInterviewAbandoned(session(), NOW)).toBe(true);
  });

  it("leaves an invitation alone while the deadline is still ahead", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();

    expect(isInterviewAbandoned(session({ expires_at: future }), NOW)).toBe(false);
  });

  it("never sweeps a session that was given no deadline", () => {
    // Guessing a deadline here would close an invitation nobody dated.
    expect(isInterviewAbandoned(session({ expires_at: null }), NOW)).toBe(false);
  });

  it("never sweeps a session whose deadline is unparseable", () => {
    expect(isInterviewAbandoned(session({ expires_at: "not-a-date" }), NOW)).toBe(false);
  });

  /**
   * The hazard this rule exists for: a candidate starts at deadline-minus-two-
   * minutes and is mid-answer when the sweep runs. Expiring them destroys a real
   * interview and its transcript.
   */
  it("protects a call that is still running when its deadline passes", () => {
    const live = session({ status: "in_progress", started_at: minutesAgo(2) });

    expect(isInterviewAbandoned(live, NOW)).toBe(false);
  });

  it("abandons a started call once it cannot still be running", () => {
    const stale = session({
      status: "in_progress",
      started_at: minutesAgo(INTERVIEW_DURATION_MINUTES + ABANDONED_GRACE_MINUTES + 1),
    });

    expect(isInterviewAbandoned(stale, NOW)).toBe(true);
  });

  it("holds a started call for the full call length plus grace", () => {
    // One minute inside the window is still protected — the boundary is what a
    // slow finish or a reconnect lands on.
    const justInside = session({
      status: "in_progress",
      started_at: minutesAgo(INTERVIEW_DURATION_MINUTES + ABANDONED_GRACE_MINUTES - 1),
    });

    expect(isInterviewAbandoned(justInside, NOW)).toBe(false);
  });

  it("abandons an in-progress row with no start time, since no call can be running", () => {
    const stale = session({ status: "in_progress", started_at: null });

    expect(isInterviewAbandoned(stale, NOW)).toBe(true);
  });
});
