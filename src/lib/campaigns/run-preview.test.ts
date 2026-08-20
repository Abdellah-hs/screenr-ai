import { describe, expect, it } from "vitest";
import { campaignRunSteps, runStepSummary, type RunConfig } from "./run-preview";
import type { SlaTimer } from "@/lib/constants";

const TIMER: SlaTimer = {
  stage: "screening",
  time_limit_hours: 48,
  alert_threshold_hours: 36,
  escalation_threshold_hours: 44,
};

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    status: "active",
    automationMode: "human_in_loop",
    screeningThreshold: 70,
    resumeDimensions: 4,
    interviewPersona: "neutral",
    slaTimers: [TIMER],
    slotMinutes: 45,
    horizonDays: 14,
    ...overrides,
  };
}

describe("campaignRunSteps", () => {
  it("says a draft campaign runs nothing at all", () => {
    const [applyLink] = campaignRunSteps(config({ status: "draft" }));

    expect(applyLink.actor).toBe("blocked");
    expect(applyLink.detail).toContain("Draft");
  });

  it("distinguishes an active campaign with intake off from a live one", () => {
    const live = campaignRunSteps(config({ status: "active" }))[0];
    const noIntake = campaignRunSteps(config({ status: "active_no_intake" }))[0];

    expect(live.actor).toBe("automatic");
    expect(noIntake.actor).toBe("blocked");
  });

  it("names the threshold as an auto-rejection only in fully-auto mode", () => {
    const auto = campaignRunSteps(config({ automationMode: "fully_auto" }))[1];
    const hitl = campaignRunSteps(config({ automationMode: "human_in_loop" }))[1];

    expect(auto.detail).toContain("auto-rejected");
    expect(hitl.detail).toContain("rejects nobody");
  });

  it("flags an empty resume rubric as a step that cannot run", () => {
    const scoring = campaignRunSteps(config({ resumeDimensions: 0 }))[1];

    expect(scoring.actor).toBe("blocked");
    expect(scoring.detail).toContain("unscored");
  });

  it("makes the approval step a person's under human-in-the-loop", () => {
    const approval = campaignRunSteps(config({ automationMode: "human_in_loop" }))[2];

    expect(approval.actor).toBe("person");
  });

  it("makes the approval step automatic under fully-auto", () => {
    const approval = campaignRunSteps(config({ automationMode: "fully_auto" }))[2];

    expect(approval.actor).toBe("automatic");
  });

  it("warns when no SLA timer will chase a stalled candidate", () => {
    const screening = campaignRunSteps(config({ slaTimers: [] }))[3];

    expect(screening.detail).toContain("nothing will chase");
  });

  it("says the SLA timers never advance or reject", () => {
    const screening = campaignRunSteps(config())[3];

    expect(screening.detail).toContain("never advance or reject");
  });

  it("ends on the hire decision, which is always a person's", () => {
    const steps = campaignRunSteps(config());

    expect(steps[steps.length - 1]).toMatchObject({
      title: "You decide the hire",
      actor: "person",
    });
  });

  it("promises no combined score at any automation setting", () => {
    for (const mode of ["fully_auto", "human_in_loop"] as const) {
      const steps = campaignRunSteps(config({ automationMode: mode }));
      expect(steps[steps.length - 1].detail).toContain("no score is ever combined");
    }
  });
});

describe("runStepSummary", () => {
  it("counts where the line between machine and person falls", () => {
    const steps = campaignRunSteps(
      config({ status: "active", automationMode: "human_in_loop" }),
    );

    expect(runStepSummary(steps)).toBe(
      "Two steps run without you, 2 wait for a person.",
    );
  });

  it("calls out steps that cannot run with the current settings", () => {
    const steps = campaignRunSteps(config({ status: "draft" }));

    expect(runStepSummary(steps)).toContain("1 cannot run with these settings");
  });

  it("moves a step from the person column to the machine column with the mode", () => {
    const hitl = runStepSummary(campaignRunSteps(config({ automationMode: "human_in_loop" })));
    const auto = runStepSummary(campaignRunSteps(config({ automationMode: "fully_auto" })));

    expect(hitl).not.toBe(auto);
    expect(auto).toContain("Three steps run without you");
  });
});
