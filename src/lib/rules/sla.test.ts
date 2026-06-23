import { describe, it, expect } from "vitest";
import { hoursInStage, slaBreachLevel } from "./sla";
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
