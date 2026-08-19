import { describe, it, expect } from "vitest";
import {
  applicationSlaStatus,
  hoursInStage,
  slaBreachLevel,
  slaStageFor,
} from "./sla";
import type { SlaTimer } from "@/lib/constants";

const timers: SlaTimer[] = [
  { stage: "screening", time_limit_hours: 48, alert_threshold_hours: 36, escalation_threshold_hours: 44 },
  { stage: "interview", time_limit_hours: 72, alert_threshold_hours: 48, escalation_threshold_hours: 60 },
];

describe("hoursInStage", () => {
  it("returns whole hours since the last-activity timestamp", () => {
    const now = new Date("2026-06-23T12:00:00.000Z");
    const tenHoursAgo = "2026-06-23T02:00:00.000Z";

    expect(hoursInStage(tenHoursAgo, now)).toBe(10);
  });
});

describe("slaBreachLevel", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  const hours = (h: number) => hoursInStage(new Date(now.getTime() - h * 3_600_000).toISOString(), now);

  it("returns null below the alert threshold", () => {
    expect(slaBreachLevel("screening", hours(30), timers)).toBeNull();
  });

  it("returns 'alert' between the alert and escalation thresholds", () => {
    expect(slaBreachLevel("screening", hours(40), timers)).toBe("alert");
  });

  it("returns 'escalation' at or past the escalation threshold", () => {
    expect(slaBreachLevel("screening", hours(50), timers)).toBe("escalation");
  });

  it("uses the per-stage thresholds (interview differs from screening)", () => {
    // 50h breaches screening's escalation (44) but is only an interview alert (48).
    expect(slaBreachLevel("interview", hours(50), timers)).toBe("alert");
  });

  it("returns null when the campaign has no timer for the stage", () => {
    expect(slaBreachLevel("applied", hours(100), timers)).toBeNull();
  });
});

describe("slaStageFor", () => {
  it("maps each active pipeline stage to its SLA stage", () => {
    expect(slaStageFor("applied")).toBe("applied");
    expect(slaStageFor("screening")).toBe("screening");
    expect(slaStageFor("interview")).toBe("interview");
    expect(slaStageFor("final_interview")).toBe("final_interview");
  });

  /**
   * An SLA catches applications that are stuck. A hired or rejected candidate
   * stopped moving because a decision was made, which is the opposite — and
   * flagging them would fill the overdue filter with people nobody is waiting
   * on, which is how a filter stops being read.
   */
  it("has no SLA for terminal stages", () => {
    expect(slaStageFor("hired")).toBeNull();
    expect(slaStageFor("rejected")).toBeNull();
  });
});

describe("applicationSlaStatus", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  const hoursAgo = (h: number) =>
    new Date(now.getTime() - h * 3_600_000).toISOString();

  it("reports the breach level and whole hours in stage", () => {
    expect(applicationSlaStatus("screening", hoursAgo(40), timers, now)).toEqual({
      level: "alert",
      hours: 40,
    });
  });

  it("floors the hours so a badge never claims a fractional hour", () => {
    expect(applicationSlaStatus("screening", hoursAgo(40.7), timers, now)?.hours).toBe(40);
  });

  it("returns null below the alert threshold", () => {
    expect(applicationSlaStatus("screening", hoursAgo(30), timers, now)).toBeNull();
  });

  it("returns null for a terminal stage however long it has sat there", () => {
    // Someone rejected six months ago is not an overdue candidate.
    expect(applicationSlaStatus("rejected", hoursAgo(5000), timers, now)).toBeNull();
    expect(applicationSlaStatus("hired", hoursAgo(5000), timers, now)).toBeNull();
  });

  it("returns null when the campaign configured no timer for that stage", () => {
    expect(applicationSlaStatus("applied", hoursAgo(500), timers, now)).toBeNull();
  });

  it("escalates once past the escalation threshold", () => {
    expect(applicationSlaStatus("screening", hoursAgo(50), timers, now)?.level).toBe(
      "escalation",
    );
  });
});
