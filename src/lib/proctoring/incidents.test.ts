import { describe, it, expect } from "vitest";
import {
  summarizeProctoring,
  CAMERA_OFF_MIN_MS,
  TAB_BLUR_MIN_MS,
  type ProctoringEvent,
} from "./incidents";

function event(overrides: Partial<ProctoringEvent> = {}): ProctoringEvent {
  return {
    type: "tab_blur",
    at: "2026-07-29T10:00:00.000Z",
    duration_ms: 5_000,
    ...overrides,
  };
}

describe("summarizeProctoring", () => {
  it("reports a clean interview when no events were observed", () => {
    const report = summarizeProctoring([]);

    expect(report.incidents).toEqual([]);
    expect(report.summary.overall_severity).toBe("clean");
  });

  it("drops a camera gap shorter than the presence threshold", () => {
    const events = [event({ type: "camera_off", duration_ms: CAMERA_OFF_MIN_MS - 1 })];

    const report = summarizeProctoring(events);

    expect(report.incidents).toEqual([]);
    expect(report.summary.camera_off_count).toBe(0);
  });

  it("drops a tab blur shorter than the debounce threshold", () => {
    const events = [event({ type: "tab_blur", duration_ms: TAB_BLUR_MIN_MS - 1 })];

    const report = summarizeProctoring(events);

    expect(report.incidents).toEqual([]);
    expect(report.summary.tab_blur_count).toBe(0);
  });

  it("keeps a camera gap at exactly the presence threshold", () => {
    const events = [event({ type: "camera_off", duration_ms: CAMERA_OFF_MIN_MS })];

    const report = summarizeProctoring(events);

    expect(report.incidents).toHaveLength(1);
  });

  it("escalates a sustained tab blur from warning to critical", () => {
    const brief = summarizeProctoring([event({ type: "tab_blur", duration_ms: 2_000 })]);
    const sustained = summarizeProctoring([event({ type: "tab_blur", duration_ms: 60_000 })]);

    expect(brief.incidents[0].severity).toBe("warning");
    expect(sustained.incidents[0].severity).toBe("critical");
  });

  it("escalates a sustained camera gap from warning to critical", () => {
    const brief = summarizeProctoring([event({ type: "camera_off", duration_ms: 6_000 })]);
    const sustained = summarizeProctoring([event({ type: "camera_off", duration_ms: 120_000 })]);

    expect(brief.incidents[0].severity).toBe("warning");
    expect(sustained.incidents[0].severity).toBe("critical");
  });

  it("counts and totals each incident type separately", () => {
    const events = [
      event({ type: "tab_blur", duration_ms: 3_000 }),
      event({ type: "tab_blur", duration_ms: 4_000 }),
      event({ type: "camera_off", duration_ms: 10_000 }),
    ];

    const report = summarizeProctoring(events);

    expect(report.summary.tab_blur_count).toBe(2);
    expect(report.summary.tab_blur_total_ms).toBe(7_000);
    expect(report.summary.camera_off_count).toBe(1);
    expect(report.summary.camera_off_total_ms).toBe(10_000);
  });

  it("takes the overall severity from the worst single incident", () => {
    const events = [
      event({ type: "tab_blur", duration_ms: 2_000 }),
      event({ type: "camera_off", duration_ms: 120_000 }),
    ];

    const report = summarizeProctoring(events);

    expect(report.summary.overall_severity).toBe("critical");
  });

  it("orders incidents chronologically regardless of report order", () => {
    const events = [
      event({ at: "2026-07-29T10:05:00.000Z", duration_ms: 2_000 }),
      event({ at: "2026-07-29T10:01:00.000Z", duration_ms: 2_000 }),
    ];

    const report = summarizeProctoring(events);

    expect(report.incidents.map((i) => i.at)).toEqual([
      "2026-07-29T10:01:00.000Z",
      "2026-07-29T10:05:00.000Z",
    ]);
  });

  it("stamps the report so a stored summary is traceable to its ruleset", () => {
    const report = summarizeProctoring([]);

    expect(report.report_version).toBeTruthy();
    expect(Date.parse(report.generated_at)).not.toBeNaN();
  });
});
