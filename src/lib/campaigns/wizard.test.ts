import { describe, expect, it } from "vitest";
import {
  WIZARD_STEPS,
  canLeaveStep,
  draftPreflight,
  draftToFormData,
  emptyDraft,
  furthestReachable,
  progressLabel,
  resumeDimensionCount,
  stepBlockers,
  stepPosition,
  type CampaignDraft,
} from "./wizard";
import { parseCampaignFormData } from "@/lib/validations";
import type { RubricDimension } from "@/lib/constants";

function dimension(name: string): RubricDimension {
  return {
    id: `dim-${name}`,
    name,
    importance: "high",
    is_mandatory: true,
    weight: 0,
    min_score: 0,
    max_score: 100,
    sort_order: 0,
  };
}

/** A draft that clears every gate, so a test can break exactly one thing. */
function validDraft(patch: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    ...emptyDraft(),
    title: "Senior Backend Engineer",
    description: "Own our payments platform end to end.",
    ...patch,
  };
}

describe("stepBlockers", () => {
  it("refuses to leave the role step without a title", () => {
    expect(stepBlockers(validDraft({ title: "  " }), "role")).toHaveLength(1);
  });

  it("refuses a description too short for the AI to draft a rubric from", () => {
    expect(stepBlockers(validDraft({ description: "Backend" }), "role")).toHaveLength(1);
    expect(stepBlockers(validDraft({ description: "Backend, on payments." }), "role")).toEqual([]);
  });

  it("refuses a screening threshold outside 0–100", () => {
    expect(stepBlockers(validDraft({ screeningThreshold: 101 }), "rules")).toHaveLength(1);
    expect(stepBlockers(validDraft({ screeningThreshold: -1 }), "rules")).toHaveLength(1);
    expect(stepBlockers(validDraft({ screeningThreshold: 0 }), "rules")).toEqual([]);
  });

  it("refuses an unnamed rubric dimension, because saving one discards the rubric", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension("Go depth"), dimension("  ")];

    expect(stepBlockers(draft, "rubric")).toHaveLength(1);
  });

  it("refuses a timer whose escalation lands after the limit it escalates before", () => {
    const draft = validDraft({
      slaTimers: [
        {
          stage: "screening",
          time_limit_hours: 48,
          alert_threshold_hours: 36,
          escalation_threshold_hours: 72,
        },
      ],
    });

    expect(stepBlockers(draft, "team")).toHaveLength(1);
  });

  it("accepts a timer that alerts, then escalates, then breaches", () => {
    const draft = validDraft({
      slaTimers: [
        {
          stage: "screening",
          time_limit_hours: 48,
          alert_threshold_hours: 36,
          escalation_threshold_hours: 44,
        },
      ],
    });

    expect(stepBlockers(draft, "team")).toEqual([]);
  });

  it("refuses a reviewer row with no email rather than posting a nameless one", () => {
    const draft = validDraft({
      reviewers: [
        {
          id: "r1",
          user_id: "user-temp-1",
          name: "Sam",
          email: "  ",
          avatar_url: null,
          role: "reviewer",
          assigned_at: new Date().toISOString(),
        },
      ],
    });

    expect(stepBlockers(draft, "team")).toHaveLength(1);
  });

  it("lets an empty rubric through — nothing gets scored, and that is said out loud", () => {
    expect(stepBlockers(validDraft(), "rubric")).toEqual([]);
    expect(resumeDimensionCount(validDraft())).toBe(0);
  });

  it("never blocks the last step", () => {
    expect(stepBlockers(emptyDraft(), "review")).toEqual([]);
  });
});

describe("furthestReachable", () => {
  it("stops at the first step that still owes something", () => {
    expect(furthestReachable(emptyDraft(), 0)).toBe(0);
  });

  it("opens the whole rail once every gate is clear", () => {
    expect(furthestReachable(validDraft(), 0)).toBe(WIZARD_STEPS.length - 1);
  });

  it("never strands you behind the step you are already on", () => {
    // Blank title, but the recruiter is standing on step 3 — going back and
    // forward has to keep working rather than snapping them to step 1.
    expect(furthestReachable(emptyDraft(), 2)).toBe(2);
  });
});

describe("stepPosition", () => {
  it("reads a step as past, current or ahead of where you are", () => {
    expect(stepPosition(0, 1)).toBe("past");
    expect(stepPosition(1, 1)).toBe("current");
    expect(stepPosition(2, 1)).toBe("ahead");
  });
});

describe("progressLabel", () => {
  it("counts from one, not zero", () => {
    expect(progressLabel(0)).toBe("Step 1 of 5");
    expect(progressLabel(4)).toBe("Step 5 of 5");
  });
});

describe("draftPreflight", () => {
  it("says an empty resume rubric means nothing is scored, rather than just ticking nothing", () => {
    const item = draftPreflight(validDraft()).find((i) => i.step === "rubric");

    expect(item?.done).toBe(false);
    expect(item?.label).toContain("no CV is scored");
  });

  it("counts the resume dimensions once they exist", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension("Go depth")];

    expect(draftPreflight(draft).find((i) => i.step === "rubric")).toMatchObject({
      done: true,
      label: "Resume rubric · 1 dimension",
    });
  });
});

describe("draftToFormData", () => {
  it("produces a payload the server action's own parser accepts", () => {
    const draft = validDraft({
      department: "Engineering",
      positions: 3,
      location: "Remote",
      status: "active_no_intake",
      deadline: "2026-12-01",
      deadlineEnforced: true,
      automationMode: "fully_auto",
      screeningThreshold: 65,
      interviewPersona: "socratic",
      slotMinutes: 30,
      horizonDays: 21,
    });
    draft.rubrics[0].dimensions = [dimension("Go depth")];
    draft.slaTimers = [
      {
        stage: "screening",
        time_limit_hours: 48,
        alert_threshold_hours: 36,
        escalation_threshold_hours: 44,
      },
    ];

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed).toMatchObject({
      title: "Senior Backend Engineer",
      department: "Engineering",
      positions: 3,
      location: "Remote",
      // The dropdown's two "Active —" options decode into status + intake flag.
      status: "active",
      accepting_applications: false,
      deadline: "2026-12-01",
      deadline_enforced: true,
      automation_mode: "fully_auto",
      screening_threshold: 65,
      interview_persona: "socratic",
      interview_slot_minutes: 30,
      interview_booking_horizon_days: 21,
    });
    expect(parsed.rubrics.find((r) => r.stage === "resume")?.dimensions).toHaveLength(1);
    expect(parsed.slaTimers).toHaveLength(1);
  });

  it("survives a draft nobody filled in beyond the title", () => {
    const parsed = parseCampaignFormData(
      draftToFormData(validDraft({ department: "", location: "", deadline: "" })),
    );

    expect(parsed).toMatchObject({
      status: "draft",
      department: null,
      location: null,
      deadline: null,
      deadline_enforced: false,
      positions: 1,
    });
  });

  it("sends an emptied rubric stage rather than omitting it", () => {
    const fd = draftToFormData(validDraft());
    const rubrics = JSON.parse(fd.get("rubrics_json") as string) as { stage: string }[];

    expect(rubrics.map((r) => r.stage)).toEqual(["resume", "screening_q", "interview"]);
  });
});

describe("canLeaveStep", () => {
  it("agrees with stepBlockers on every step of a valid draft", () => {
    for (const step of WIZARD_STEPS) {
      expect(canLeaveStep(validDraft(), step.key), step.key).toBe(true);
    }
  });
});
