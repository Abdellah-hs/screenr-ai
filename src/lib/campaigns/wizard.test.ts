import { describe, expect, it } from "vitest";
import {
  RUBRIC_STAGES,
  WIZARD_STEPS,
  canLeaveStep,
  dimensionsFor,
  discardSummary,
  draftFromCampaign,
  draftToFormData,
  emptyDraft,
  furthestReachable,
  progressLabel,
  resumeDimensionCount,
  stepBlockers,
  stepPosition,
  wizardRail,
  type CampaignDraft,
} from "./wizard";
import { parseCampaignFormData } from "@/lib/validations";
import type { Campaign, EvaluationRubric, RubricDimension } from "@/lib/constants";

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

  /**
   * The editor shows one stage tab at a time while this scans all three, so a
   * blocker that does not say WHERE sends the recruiter hunting for a blank
   * field on a tab they are not looking at.
   */
  it("says which rubric the unnamed dimension is in", () => {
    const draft = validDraft();
    draft.rubrics[2].dimensions = [dimension("Live problem solving"), dimension("")];

    expect(stepBlockers(draft, "rubric")[0]).toContain("Interview");
  });

  it("reports each stage separately rather than pooling the count", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension("")];
    draft.rubrics[1].dimensions = [dimension("")];

    const blockers = stepBlockers(draft, "rubric");

    // One sentence per tab the recruiter has to visit, not "2 dimensions".
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toContain("Resume");
    expect(blockers[1]).toContain("Screening questions");
  });

  it("counts the blanks within a stage instead of repeating the sentence", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension(""), dimension("  ")];

    const blockers = stepBlockers(draft, "rubric");

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("2");
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
    expect(progressLabel(0, 6)).toBe("Step 1 of 6");
    expect(progressLabel(4, 6)).toBe("Step 5 of 6");
  });

  it("counts the stages it is given, so it cannot disagree with the rail", () => {
    expect(progressLabel(4, wizardRail(false).length)).toBe("Step 5 of 6");
    expect(progressLabel(4, wizardRail(true).length)).toBe("Step 5 of 5");
  });
});

describe("wizardRail", () => {
  it("draws the share stage from the start when creating", () => {
    const rail = wizardRail(false);

    expect(rail).toHaveLength(WIZARD_STEPS.length + 1);
    expect(rail.at(-1)).toEqual({ key: "share", label: "Share", form: false });
  });

  it("stops at the last form step when editing, which never reaches share", () => {
    const rail = wizardRail(true);

    expect(rail).toHaveLength(WIZARD_STEPS.length);
    expect(rail.every((stage) => stage.form)).toBe(true);
  });

  /**
   * The bug this guards: a sixth entry in `WIZARD_STEPS` would move `LAST`, so
   * the wizard's Create button would render as Next and the campaign would
   * never be written. The rail may be longer than the form; the form may not.
   */
  it("does not lengthen the form itself", () => {
    expect(WIZARD_STEPS.some((step) => step.key === ("share" as string))).toBe(false);
    expect(wizardRail(false).filter((stage) => stage.form)).toHaveLength(
      WIZARD_STEPS.length,
    );
  });
});

describe("discardSummary", () => {
  /**
   * The dialog names what is lost instead of asking "are you sure?" — a
   * question that makes the reader reconstruct what they typed, when the
   * dialog already knows.
   */
  it("names the campaign by its title", () => {
    const draft = validDraft();
    draft.title = "Senior Data Engineer";

    expect(discardSummary(draft)).toContain('"Senior Data Engineer"');
  });

  it("counts rubric dimensions across every stage, not just the resume one", () => {
    const draft = validDraft();
    draft.title = "";
    draft.rubrics[0].dimensions = [dimension("Go depth")];
    draft.rubrics[2].dimensions = [dimension("Live problem solving")];

    expect(discardSummary(draft)).toBe("2 rubric dimensions");
  });

  it("says one dimension in the singular", () => {
    const draft = validDraft();
    draft.title = "";
    draft.rubrics[0].dimensions = [dimension("Go depth")];

    expect(discardSummary(draft)).toBe("1 rubric dimension");
  });

  it("names both when both exist", () => {
    const draft = validDraft();
    draft.title = "Designer";
    draft.rubrics[0].dimensions = [dimension("Portfolio depth")];

    expect(discardSummary(draft)).toBe('"Designer" and 1 rubric dimension');
  });

  /**
   * Reachable: the dialog opens on a description alone, which is deliberately
   * not named — it is long, and quoting it would fill the modal.
   */
  it("falls back to a generic phrase rather than an empty sentence", () => {
    const draft = validDraft();
    draft.title = "  ";

    expect(discardSummary(draft)).toBe("This draft");
  });
});

describe("draftToFormData — screening questions", () => {
  /**
   * Collected in the wizard rather than after creation. Approving anyone into
   * screening needs questions, and the apply link goes live the moment the
   * campaign does — so a campaign created without them can take applications
   * it cannot act on.
   */
  it("carries the staged questions through to the server parser", () => {
    const draft = validDraft({
      screeningQuestions: [
        { prompt: "Describe a system you scaled past its first design." },
        { prompt: "What made you look outside your current role?" },
      ],
    });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.screeningQuestions).toEqual([
      { prompt: "Describe a system you scaled past its first design." },
      { prompt: "What made you look outside your current role?" },
    ]);
  });

  it("creates a campaign with none when the recruiter skipped them", () => {
    const parsed = parseCampaignFormData(draftToFormData(validDraft()));

    expect(parsed.screeningQuestions).toEqual([]);
  });

  /**
   * safeParseJsonArray drops the WHOLE array on any invalid element, so a
   * half-typed question left in the draft would silently discard every good
   * one alongside it. Filtering here keeps the rest.
   */
  it("drops a half-typed question without taking the good ones with it", () => {
    const draft = validDraft({
      screeningQuestions: [
        { prompt: "Describe a system you scaled past its first design." },
        { prompt: "why?" },
      ],
    });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.screeningQuestions).toEqual([
      { prompt: "Describe a system you scaled past its first design." },
    ]);
  });

  it("trims a question before staging it", () => {
    const draft = validDraft({
      screeningQuestions: [{ prompt: "   Tell us about a hard trade-off.   " }],
    });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.screeningQuestions).toEqual([
      { prompt: "Tell us about a hard trade-off." },
    ]);
  });
});

describe("draftToFormData — both score bars", () => {
  /**
   * The wizard predated the threshold split and sent only one number, which
   * would have left the CV gate on its column default while the recruiter
   * believed they had set it.
   */
  it("sends the resume and screening bars separately", () => {
    const draft = validDraft({ resumeThreshold: 80, screeningThreshold: 55 });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.resume_threshold).toBe(80);
    expect(parsed.screening_threshold).toBe(55);
  });

  it("does not let one bar stand in for the other", () => {
    const draft = validDraft({ resumeThreshold: 90, screeningThreshold: 40 });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.resume_threshold).not.toBe(parsed.screening_threshold);
  });
});

describe("stepBlockers — screening coverage", () => {
  const gap = {
    uncoveredDimensions: [
      { dimensionId: "d3", dimensionName: "Team communication", reason: "Nothing probes it." },
    ],
  };

  /**
   * The reason coverage is a parameter and not something this module computes:
   * `stepBlockers` is pure and the wizard calls it on every render, while a
   * coverage check is a round-trip to a model. Omitting it must be harmless.
   */
  it("says nothing about coverage when none has been checked", () => {
    expect(stepBlockers(validDraft(), "rubric")).toEqual([]);
    expect(stepBlockers(validDraft(), "rubric", null)).toEqual([]);
  });

  it("reports a gap on the rubric step", () => {
    const blockers = stepBlockers(validDraft(), "rubric", gap);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("Team communication");
  });

  it("says nothing when every dimension is covered", () => {
    expect(stepBlockers(validDraft(), "rubric", { uncoveredDimensions: [] })).toEqual([]);
  });

  /** Coverage is about the rubric step; it must not leak onto the others. */
  it("does not raise a coverage gap on any other step", () => {
    for (const key of ["role", "rules", "team", "review"] as const) {
      expect(stepBlockers(validDraft(), key, gap)).toEqual([]);
    }
  });

  it("still reports the unnamed-dimension blocker alongside a coverage gap", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension("  ")];

    const blockers = stepBlockers(draft, "rubric", gap);

    expect(blockers).toHaveLength(2);
  });
});

describe("canLeaveStep", () => {
  /**
   * The step rail is driven by this, so a coverage gap must never make a step
   * unreachable — the recruiter has to be able to walk back to the questions to
   * fix the very thing being warned about.
   */
  it("ignores coverage entirely, so the rail can never trap anyone", () => {
    expect(canLeaveStep(validDraft(), "rubric")).toBe(true);
  });
});

describe("draftToFormData — deadline enforcement", () => {
  /**
   * The wizard only shows "After the deadline passes" once a date is set, so a
   * draft can reach here holding `true` from a date that was picked and then
   * cleared. Storing that would record a campaign as enforcing a deadline it
   * does not have — inert, because `isCampaignAcceptingApplications` ignores
   * enforcement when `deadline` is null, but a lie in the record all the same.
   */
  it("does not enforce a deadline that is not set", () => {
    const draft = validDraft({ deadline: "", deadlineEnforced: true });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.deadline_enforced).toBe(false);
  });

  it("keeps enforcement when there is a date to enforce", () => {
    const draft = validDraft({ deadline: "2026-12-01", deadlineEnforced: true });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.deadline_enforced).toBe(true);
  });

  it("leaves an unenforced deadline informational", () => {
    const draft = validDraft({ deadline: "2026-12-01", deadlineEnforced: false });

    const parsed = parseCampaignFormData(draftToFormData(draft));

    expect(parsed.deadline_enforced).toBe(false);
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

  /**
   * `rubricSchema` requires a non-empty name and `safeParseJsonArray` swallows
   * the parse failure and returns `[]`, so one blank row would discard ALL
   * THREE rubrics on save. `stepBlockers` is meant to catch it first — this is
   * the backstop for when it does not, because the failure it guards is silent
   * and total.
   */
  it("drops a blank-named dimension instead of sending a payload that discards every rubric", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension("Go depth"), dimension("   ")];

    const fd = draftToFormData(draft);
    const rubrics = JSON.parse(fd.get("rubrics_json") as string) as {
      dimensions: { name: string }[];
    }[];

    expect(rubrics[0].dimensions.map((d) => d.name)).toEqual(["Go depth"]);
  });

  it("keeps the surviving rubrics when another stage carries a blank row", () => {
    const draft = validDraft();
    draft.rubrics[0].dimensions = [dimension("Go depth")];
    draft.rubrics[2].dimensions = [dimension("")];

    const fd = draftToFormData(draft);
    const rubrics = JSON.parse(fd.get("rubrics_json") as string) as {
      dimensions: { name: string }[];
    }[];

    // The whole point: a blank on the Interview tab must not cost the recruiter
    // the resume rubric they actually filled in.
    expect(rubrics[0].dimensions).toHaveLength(1);
    expect(rubrics[2].dimensions).toHaveLength(0);
  });
});

describe("canLeaveStep", () => {
  it("agrees with stepBlockers on every step of a valid draft", () => {
    for (const step of WIZARD_STEPS) {
      expect(canLeaveStep(validDraft(), step.key), step.key).toBe(true);
    }
  });
});

// ─── Editing an existing campaign ────────────────────────────────────────────

function rubric(
  stage: EvaluationRubric["stage"],
  dimensions: RubricDimension[],
): EvaluationRubric {
  return {
    id: `rub-${stage}`,
    campaign_id: "camp-1",
    stage,
    version: 2,
    is_active: true,
    dimensions,
    created_at: "2026-08-01T00:00:00Z",
    archived_at: null,
  };
}

function storedCampaign(patch: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1",
    title: "Senior Backend Engineer",
    description: "Own our payments platform end to end.",
    department: "Engineering",
    positions: 3,
    status: "active",
    accepting_applications: true,
    deadline: "2026-12-24T00:00:00+00:00",
    deadline_enforced: true,
    location: "Remote",
    timezone: null,
    public_slug: "senior-backend-engineer",
    automation_mode: "fully_auto",
    resume_threshold: 65,
    screening_threshold: 80,
    interview_persona: "collaborative",
    rubrics: [rubric("resume", [dimension("Go depth")])],
    reviewers: [],
    sla_timers: [
      {
        stage: "screening",
        time_limit_hours: 48,
        alert_threshold_hours: 36,
        escalation_threshold_hours: 44,
      },
    ],
    interview_slot_minutes: 60,
    interview_timezone: "Europe/Paris",
    interview_booking_horizon_days: 21,
    interview_availability_rules: [],
    pipeline: [],
    user_id: "user-1",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    deleted_at: null,
    ...patch,
  };
}

describe("draftFromCampaign", () => {
  /**
   * The whole point of editing through the wizard: the payload an edit posts
   * is built by the same serialiser a creation posts, so a field cannot be
   * savable on one side and quietly dropped on the other. Round-tripping an
   * untouched campaign is the test that holds that.
   */
  it("round-trips an untouched campaign through the server parser", () => {
    const campaign = storedCampaign();

    const parsed = parseCampaignFormData(draftToFormData(draftFromCampaign(campaign)));

    expect(parsed).toMatchObject({
      title: "Senior Backend Engineer",
      description: "Own our payments platform end to end.",
      department: "Engineering",
      positions: 3,
      status: "active",
      accepting_applications: true,
      deadline_enforced: true,
      location: "Remote",
      automation_mode: "fully_auto",
      resume_threshold: 65,
      screening_threshold: 80,
      interview_persona: "collaborative",
      interview_slot_minutes: 60,
      interview_timezone: "Europe/Paris",
      interview_booking_horizon_days: 21,
    });
  });

  /**
   * Stored as a lifecycle status plus an intake switch, shown as one dropdown.
   * Encoding the wrong way round would silently re-open a campaign the
   * recruiter had closed to new applicants.
   */
  it("shows an active campaign with intake off as the combined option", () => {
    const draft = draftFromCampaign(
      storedCampaign({ status: "active", accepting_applications: false }),
    );

    expect(draft.status).toBe("active_no_intake");

    const parsed = parseCampaignFormData(draftToFormData(draft));
    expect(parsed.status).toBe("active");
    expect(parsed.accepting_applications).toBe(false);
  });

  /**
   * A date input wants YYYY-MM-DD. Parsing the stored timestamp as a Date and
   * formatting it locally would move the deadline a day earlier for anyone west
   * of UTC — every save shifting it again.
   */
  it("keeps the stored deadline day rather than the local one", () => {
    expect(draftFromCampaign(storedCampaign()).deadline).toBe("2026-12-24");
  });

  it("carries an empty deadline as empty, not as an invalid date", () => {
    const draft = draftFromCampaign(storedCampaign({ deadline: null }));

    expect(draft.deadline).toBe("");
    expect(parseCampaignFormData(draftToFormData(draft)).deadline).toBeNull();
  });

  /**
   * The timezone is auto-detected from the calendar and has no field. Dropping
   * it here would wipe it on the first edit of every campaign that had one.
   */
  it("carries the invisible interview timezone through a save", () => {
    const parsed = parseCampaignFormData(
      draftToFormData(draftFromCampaign(storedCampaign())),
    );

    expect(parsed.interview_timezone).toBe("Europe/Paris");
  });

  /**
   * A campaign saved before a stage's rubric existed has one rubric row, not
   * three. The editor needs a tab per stage regardless, or the recruiter cannot
   * add the missing one.
   */
  it("opens a tab for every stage, including ones the campaign never had", () => {
    const draft = draftFromCampaign(storedCampaign());

    expect(draft.rubrics.map((r) => r.stage)).toEqual(RUBRIC_STAGES.map((s) => s.key));
    expect(dimensionsFor(draft, "resume")).toHaveLength(1);
    expect(dimensionsFor(draft, "interview")).toEqual([]);
  });

  it("seeds the campaign's saved screening questions", () => {
    const draft = draftFromCampaign(storedCampaign(), [
      { id: "q-1", prompt: "Describe a system you scaled past its first design." },
    ]);

    expect(draft.screeningQuestions).toEqual([
      { id: "q-1", prompt: "Describe a system you scaled past its first design." },
    ]);
  });

  /** An existing campaign is already valid, so the rail is walkable at once. */
  it("lets the recruiter jump straight to any step", () => {
    const draft = draftFromCampaign(storedCampaign());

    expect(furthestReachable(draft, 0)).toBe(WIZARD_STEPS.length - 1);
  });
});
