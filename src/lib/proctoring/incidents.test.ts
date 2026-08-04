import { describe, it, expect } from "vitest";
import {
  summarizeProctoring,
  CAMERA_OFF_MIN_MS,
  TAB_BLUR_MIN_MS,
  type ProctoringEvent,
  type VisionObservation,
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

/**
 * Vision proctoring (Phase C2). The worker samples a frame every ~10s and reports
 * how many people and how many phones it counted; these rules turn that series
 * into durations.
 *
 * The bias here is deliberate and asymmetric: wrongly accusing a real candidate
 * of having someone else in the room is far more costly than missing a genuine
 * incident, so every test below that pins down a *non*-detection is protecting
 * that property, not describing an incidental behaviour. That asymmetry matters
 * more since the interview stopped being recorded — there is no footage anyone
 * can go check a finding against.
 */
describe("summarizeProctoring — vision observations", () => {
  const T0 = Date.parse("2026-07-29T10:00:00.000Z");

  /** A run of samples 10s apart, all reading the same counts. */
  function samples(
    personCount: number,
    count: number,
    opts: {
      confidence?: number;
      startMs?: number;
      stepMs?: number;
      phoneCount?: number;
    } = {},
  ): VisionObservation[] {
    const {
      confidence = 0.95,
      startMs = 0,
      stepMs = 10_000,
      phoneCount = 0,
    } = opts;
    return Array.from({ length: count }, (_, i) => ({
      at: new Date(T0 + startMs + i * stepMs).toISOString(),
      person_count: personCount,
      confidence,
      phone_count: phoneCount,
    }));
  }

  it("raises nothing when exactly one person is present throughout", () => {
    const report = summarizeProctoring([], samples(1, 20));

    expect(report.incidents).toEqual([]);
    expect(report.summary.overall_severity).toBe("clean");
  });

  it("flags a sustained absence from frame", () => {
    // 4 samples * 10s spacing = 30s span, past PERSON_ABSENT_MIN_MS (15s).
    const report = summarizeProctoring([], samples(0, 4));

    expect(report.incidents).toHaveLength(1);
    expect(report.incidents[0]).toMatchObject({
      type: "person_absent",
      severity: "warning",
      source: "vision",
    });
  });

  it("escalates a full minute out of frame to critical", () => {
    const report = summarizeProctoring([], samples(0, 8)); // 70s span

    expect(report.incidents[0].severity).toBe("critical");
  });

  it("never accuses on a single stray frame", () => {
    // The candidate leant out of shot for one sample. One frame spans zero
    // time, so it can't clear any threshold — the core anti-false-positive rule.
    const observations = [...samples(1, 3), ...samples(0, 1, { startMs: 30_000 })];

    const report = summarizeProctoring([], observations);

    expect(report.incidents).toEqual([]);
  });

  it("ignores a brief glimpse of a second person passing behind", () => {
    // Two samples = 10s span, below MULTIPLE_PEOPLE_MIN_MS.
    const observations = [
      ...samples(1, 2),
      ...samples(2, 2, { startMs: 20_000 }),
      ...samples(1, 2, { startMs: 40_000 }),
    ];

    const report = summarizeProctoring([], observations);

    expect(report.incidents).toEqual([]);
  });

  it("flags a second person who stays in frame", () => {
    const report = summarizeProctoring([], samples(2, 5, { startMs: 0 })); // 40s

    expect(report.incidents[0]).toMatchObject({
      type: "multiple_people",
      severity: "critical",
      source: "vision",
    });
  });

  it("flags a phone that stays in shot", () => {
    // 3 samples = 20s span, past PHONE_VISIBLE_MIN_MS (15s).
    const report = summarizeProctoring([], samples(1, 3, { phoneCount: 1 }));

    expect(report.incidents).toHaveLength(1);
    expect(report.incidents[0]).toMatchObject({
      type: "phone_visible",
      severity: "warning",
      source: "vision",
    });
  });

  it("ignores a phone glimpsed in a single frame", () => {
    // Picking up a phone to silence it, or a stray reflection off one on the
    // desk. One frame spans zero time and can never clear a threshold.
    const observations = [
      ...samples(1, 2),
      ...samples(1, 1, { startMs: 20_000, phoneCount: 1 }),
      ...samples(1, 2, { startMs: 30_000 }),
    ];

    const report = summarizeProctoring([], observations);

    expect(report.incidents).toEqual([]);
  });

  // The regression guard for per-condition run tracking: before this, one run
  // was shared across all vision conditions, so whichever condition a frame was
  // attributed to first silently swallowed the other.
  it("reports two conditions present in the same frames independently", () => {
    const report = summarizeProctoring(
      [],
      samples(2, 4, { phoneCount: 1 }), // two people AND a phone, for 30s
    );

    expect(report.incidents.map((i) => i.type).sort()).toEqual([
      "multiple_people",
      "phone_visible",
    ]);
    expect(report.summary.multiple_people_count).toBe(1);
    expect(report.summary.phone_visible_count).toBe(1);
  });

  it("keeps an ongoing condition open while an overlapping one ends", () => {
    // The phone is in shot the whole time; the second person leaves halfway.
    const observations = [
      ...samples(2, 3, { phoneCount: 1 }), // 0–20s: both
      ...samples(1, 3, { startMs: 30_000, phoneCount: 1 }), // 30–50s: phone only
    ];

    const report = summarizeProctoring([], observations);

    const phone = report.incidents.filter((i) => i.type === "phone_visible");
    expect(phone).toHaveLength(1);
    expect(phone[0].duration_ms).toBe(50_000);
    expect(report.summary.multiple_people_count).toBe(1);
  });

  it("discards low-confidence samples instead of believing them", () => {
    // A dark or blurred room reading "nobody there" must not become an absence.
    const report = summarizeProctoring([], samples(0, 8, { confidence: 0.3 }));

    expect(report.incidents).toEqual([]);
    expect(report.summary.vision_sampled).toBe(false);
  });

  it("does not bridge a run across a gap where the worker stalled", () => {
    // Two 20s absences either side of a 5-minute hole. Bridging them would
    // invent a 6-minute critical incident out of no evidence.
    const observations = [
      ...samples(0, 3),
      ...samples(0, 3, { startMs: 5 * 60_000 }),
    ];

    const report = summarizeProctoring([], observations);

    expect(report.incidents).toHaveLength(2);
    expect(report.incidents.every((i) => i.severity === "warning")).toBe(true);
  });

  it("distinguishes a watched-and-clean interview from an unwatched one", () => {
    const watched = summarizeProctoring([], samples(1, 10));
    const unwatched = summarizeProctoring([], []);

    expect(watched.summary.vision_sampled).toBe(true);
    expect(unwatched.summary.vision_sampled).toBe(false);
    // Both are "clean" — only the flag tells them apart, which is why it exists.
    expect(watched.summary.overall_severity).toBe("clean");
    expect(unwatched.summary.overall_severity).toBe("clean");
  });

  it("merges browser and vision evidence into one chronological timeline", () => {
    const events = [
      { type: "tab_blur" as const, at: new Date(T0 + 90_000).toISOString(), duration_ms: 20_000 },
    ];

    const report = summarizeProctoring(events, samples(0, 4));

    expect(report.incidents.map((i) => i.source)).toEqual(["vision", "client"]);
    expect(report.summary.person_absent_count).toBe(1);
    expect(report.summary.tab_blur_count).toBe(1);
  });

  it("labels every incident with the evidence it came from", () => {
    const report = summarizeProctoring([event({ duration_ms: 20_000 })], samples(0, 4));

    const bySource = Object.fromEntries(report.incidents.map((i) => [i.type, i.source]));
    expect(bySource).toEqual({ tab_blur: "client", person_absent: "vision" });
  });
});
