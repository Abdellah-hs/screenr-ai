import { describe, expect, it } from "vitest";
import {
  interviewAbsence,
  interviewWasTaken,
  mandatoryDimensionNames,
  screeningCallWasTaken,
  screeningWasSent,
  withInterviewScore,
  neighbourNav,
  slaPhrase,
  stagePill,
  stageScoreRows,
  timeInStageLabel,
} from "./detail-header";
import {
  APPLICATION_STAGE_BUCKET,
  type ApplicationState,
  type CandidateScore,
} from "@/lib/constants";

const ALL_STATES = Object.keys(APPLICATION_STAGE_BUCKET) as ApplicationState[];

function score(
  stage: CandidateScore["stage"],
  overall: number,
  patch: Partial<CandidateScore> = {},
): CandidateScore {
  return {
    stage,
    overall,
    tier: "strong",
    ai_summary: "",
    factors: [],
    evaluation: null,
    scored_at: "2026-08-14T08:57:00.000Z",
    rubric_version: 3,
    current_rubric_version: 3,
    ...patch,
  };
}

describe("stagePill", () => {
  it("gives every application state a pill", () => {
    for (const state of ALL_STATES) {
      expect(stagePill(state).label.length, state).toBeGreaterThan(0);
    }
  });

  it("keeps the palette the funnel and table already use", () => {
    expect(stagePill("screening_sent")).toMatchObject({
      label: "Screening",
      ink: "#2563EB",
    });
    expect(stagePill("hired").ink).toBe("#059669");
  });
});

describe("timeInStageLabel", () => {
  it("switches from hours to days at two days", () => {
    expect(timeInStageLabel(6)).toBe("6 hours in stage");
    expect(timeInStageLabel(47)).toBe("47 hours in stage");
    expect(timeInStageLabel(72)).toBe("3 days in stage");
  });

  it("says nothing rather than guessing when nothing has moved", () => {
    expect(timeInStageLabel(null)).toBeNull();
  });

  it("does not render a fraction of an hour as 0", () => {
    expect(timeInStageLabel(0.4)).toBe("under an hour in stage");
  });
});

describe("slaPhrase", () => {
  it("distinguishes a healthy timer from no timer at all", () => {
    expect(slaPhrase(null, true)).toEqual({ text: "within SLA", breached: false });
    expect(slaPhrase(null, false)).toEqual({
      text: "no SLA timer on this stage",
      breached: false,
    });
  });

  it("separates an alert from an escalation", () => {
    expect(slaPhrase({ level: "alert", hours: 50 }, true).text).toBe("past SLA");
    expect(slaPhrase({ level: "escalation", hours: 70 }, true).text).toBe(
      "past SLA · escalated",
    );
  });
});

describe("stageScoreRows", () => {
  it("always returns exactly the three stages, never a total", () => {
    const rows = stageScoreRows([score("resume", 78)], "screening_sent");

    expect(rows.map((r) => r.label)).toEqual(["CV", "Screening", "Interview"]);
  });

  it("names a stage the pipeline has not reached differently from one it has", () => {
    const rows = stageScoreRows([score("resume", 78)], "screening_sent");

    expect(rows[1]).toMatchObject({ detail: "Awaiting the call", reached: true });
    expect(rows[2]).toMatchObject({ detail: "Not reached yet", reached: false });
  });

  it("says the screening expired rather than that it was never taken", () => {
    const rows = stageScoreRows([score("resume", 78)], "screening_expired");

    expect(rows[1].detail).toBe("Screening expired");
  });

  it("carries the rubric version and date when a score exists", () => {
    const rows = stageScoreRows([score("screening", 84)], "screening_scored");

    expect(rows[1]).toMatchObject({
      score: 84,
      tierLabel: "Strong",
      detail: "rubric v3 · Aug 14",
      reached: true,
    });
  });

  it("does not print 'rubric vnull' for a score recorded before versioning", () => {
    const rows = stageScoreRows(
      [score("resume", 78, { rubric_version: null })],
      "screening_sent",
    );

    expect(rows[0].detail).not.toContain("null");
  });

  it("reads how far a rejected candidate got from their scores, not their state", () => {
    // `rejected` says nothing about where the rejection happened, so a person
    // rejected after a scored interview must not read as "not reached yet".
    const rows = stageScoreRows(
      [score("resume", 78), score("screening", 84), score("interview", 61)],
      "rejected",
    );

    expect(rows.every((r) => r.reached)).toBe(true);
  });

  it("flags a stage that was passed without producing a score", () => {
    const rows = stageScoreRows([score("screening", 84)], "screening_scored");

    expect(rows[0].detail).toBe("No score recorded");
  });

  it("never leaves a row's detail blank, in any state", () => {
    for (const state of ALL_STATES) {
      for (const row of stageScoreRows([], state)) {
        expect(row.detail.length, `${state}/${row.key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("neighbourNav", () => {
  const list = [
    { id: "a", status: "screening_sent" as ApplicationState },
    { id: "b", status: "hired" as ApplicationState },
    { id: "c", status: "screening_scored" as ApplicationState },
    { id: "d", status: "screening_sent" as ApplicationState },
  ];

  it("counts within the stage the recruiter is working, not the whole campaign", () => {
    expect(neighbourNav(list, "c")).toMatchObject({
      position: 2,
      total: 3,
      stageName: "Screening",
      prevId: "a",
      nextId: "d",
    });
  });

  it("does not step out of the stage at either end", () => {
    expect(neighbourNav(list, "a")?.prevId).toBeNull();
    expect(neighbourNav(list, "d")?.nextId).toBeNull();
  });

  it("returns nothing when the candidate is not in the list it was given", () => {
    expect(neighbourNav(list, "zz")).toBeNull();
  });

  it("handles being the only person in the stage", () => {
    expect(neighbourNav(list, "b")).toMatchObject({
      position: 1,
      total: 1,
      prevId: null,
      nextId: null,
    });
  });
});

describe("interviewAbsence", () => {
  it("says the same thing about monitoring in every state, because it is the point", () => {
    for (const state of ALL_STATES) {
      expect(interviewAbsence(state).body, state).toContain("never watched");
      expect(interviewAbsence(state).body, state).toContain("not the same as a clean run");
    }
  });

  it("does not describe a lapsed window as something still being waited on", () => {
    expect(interviewAbsence("interview_expired").title).toBe(
      "The interview window closed unused",
    );
    expect(interviewAbsence("interview_invited").title).toBe("Invited — not started");
  });

  it("never implies a no-show was a rejection", () => {
    const body = interviewAbsence("interview_no_show").body;

    expect(body).toContain("Nobody rejected them");
  });

  it("gives every state a title", () => {
    for (const state of ALL_STATES) {
      expect(interviewAbsence(state).title.length, state).toBeGreaterThan(0);
    }
  });
});

describe("withInterviewScore", () => {
  const interview = {
    overall_score: 61,
    overall_rationale: "Held up on design, thin on incident ownership.",
    rubric_version: 2,
    scored_at: "2026-08-19T10:00:00.000Z",
  };

  it("stops the rail claiming an interview was never reached after scoring it", () => {
    const merged = withInterviewScore([score("resume", 78)], interview);

    expect(stageScoreRows(merged, "interview_scored")[2]).toMatchObject({
      score: 61,
      reached: true,
    });
  });

  it("carries no tier, because the interview scorer produces none", () => {
    expect(withInterviewScore([], interview)[0].tier).toBeUndefined();
  });

  it("leaves the scores alone when there is no interview score", () => {
    const scores = [score("resume", 78)];

    expect(withInterviewScore(scores, null)).toBe(scores);
  });

  it("does not add a second interview row", () => {
    const merged = withInterviewScore([score("interview", 90)], interview);

    expect(merged.filter((s) => s.stage === "interview")).toHaveLength(1);
  });
});

describe("mandatoryDimensionNames", () => {
  const rubrics = [
    {
      stage: "screening_q",
      dimensions: [
        { name: "Depth", is_mandatory: true },
        { name: "Communication", is_mandatory: false },
      ],
    },
  ];

  it("maps the screening score stage onto the screening_q rubric stage", () => {
    expect(mandatoryDimensionNames(rubrics, "screening")).toEqual(["Depth"]);
  });

  it("returns nothing for a stage with no rubric rather than throwing", () => {
    expect(mandatoryDimensionNames(rubrics, "interview")).toEqual([]);
  });
});

/**
 * These decide, on the candidate detail page, between a stage's evidence and a
 * named absence in its place. They used to be re-derived in the page while each
 * component ALSO returned null on its own copy — fine while the two agreed, and
 * silent when they drifted: the page renders the panel, the panel renders
 * nothing, and the recruiter gets a blank evidence view with no explanation.
 */
describe("interviewWasTaken", () => {
  it("is false for an invitation nobody has opened", () => {
    // A pending link, not an interview. The pipeline stage already says so, and
    // a transcript card over it would be an empty white box.
    expect(interviewWasTaken({ status: "invited", transcript: [] })).toBe(false);
  });

  it("is true once there is anything on the transcript, invited or not", () => {
    expect(interviewWasTaken({ status: "invited", transcript: [{}] })).toBe(true);
  });

  it("is true for a session that moved past invited", () => {
    expect(interviewWasTaken({ status: "completed", transcript: [] })).toBe(true);
  });

  it("is false when there is no session at all", () => {
    expect(interviewWasTaken(null)).toBe(false);
  });
});

describe("screeningWasSent", () => {
  it("is false before anything has gone out", () => {
    // Sending is automatic on approval, so the pre-send states have nothing
    // candidate-specific to show.
    expect(screeningWasSent({ status: "not_sent" })).toBe(false);
    expect(screeningWasSent({ status: "pending" })).toBe(false);
  });

  it("is false when there is no response row yet", () => {
    expect(screeningWasSent(null)).toBe(false);
    expect(screeningWasSent(undefined)).toBe(false);
  });

  it("is true from the moment the link is out", () => {
    expect(screeningWasSent({ status: "sent" })).toBe(true);
    expect(screeningWasSent({ status: "responded" })).toBe(true);
    expect(screeningWasSent({ status: "scored" })).toBe(true);
  });
});

describe("screeningCallWasTaken", () => {
  it("is true once a call finished with turns on it", () => {
    expect(screeningCallWasTaken({ status: "responded", transcript: [{}] })).toBe(true);
    expect(screeningCallWasTaken({ status: "scored", transcript: [{}] })).toBe(true);
  });

  it("is false for a link that was sent but never answered", () => {
    expect(screeningCallWasTaken({ status: "sent", transcript: [] })).toBe(false);
  });

  /**
   * A transcript exists mid-call — the worker reports it incrementally — so the
   * turns alone do not mean the call is over. Both halves are required.
   */
  it("is false while the call is still running", () => {
    expect(screeningCallWasTaken({ status: "sent", transcript: [{}, {}] })).toBe(false);
  });

  it("is false for a typed response with no call behind it", () => {
    expect(screeningCallWasTaken({ status: "scored", transcript: [] })).toBe(false);
  });
});
