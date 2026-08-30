import { describe, it, expect } from "vitest";
import {
  attachSnapshots,
  summarizeProctoring,
  CAMERA_OFF_MIN_MS,
  TAB_BLUR_MIN_MS,
  type ProctoringEvent,
  type VisionIncidentType,
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

  /**
   * Changed 2026-08-28, deliberately: this used to assert that two sightings of
   * a second person raised NOTHING. A real interview where someone appeared on
   * camera and the report stayed silent is what retired that bar. Two sightings
   * is now a warning — reported, not treated as proof.
   */
  it("flags a second person seen across two consecutive samples", () => {
    const observations = [
      ...samples(1, 2),
      ...samples(2, 2, { startMs: 20_000 }),
      ...samples(1, 2, { startMs: 40_000 }),
    ];

    const report = summarizeProctoring([], observations);

    expect(report.incidents).toHaveLength(1);
    expect(report.incidents[0]).toMatchObject({
      type: "multiple_people",
      // A brief sighting is never critical on its own — that needs
      // MULTIPLE_PEOPLE_CRITICAL_MS of continuous presence.
      severity: "warning",
    });
  });

  /**
   * The bar moved; the invariant under it did not. A run spans first sample to
   * last, so one frame is always zero-length and cannot clear ANY threshold —
   * this is what stops a single bad inference accusing a real candidate, and it
   * is the reason 5s was the floor rather than something lower.
   */
  it("still ignores a second person caught in a single frame", () => {
    const observations = [
      ...samples(1, 2),
      ...samples(2, 1, { startMs: 20_000 }),
      ...samples(1, 2, { startMs: 30_000 }),
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

  /**
   * The point of the 2026-08-28 change, stated as a test: an ordinary glance at
   * a phone is what a recruiter wants to know about, and a 15s bar reported
   * only a device parked in view long enough to read from.
   */
  it("flags a phone glanced at across two consecutive samples", () => {
    const observations = [
      ...samples(1, 2),
      ...samples(1, 2, { startMs: 20_000, phoneCount: 1 }),
      ...samples(1, 2, { startMs: 40_000 }),
    ];

    const report = summarizeProctoring([], observations);

    expect(report.incidents).toHaveLength(1);
    expect(report.incidents[0]).toMatchObject({
      type: "phone_visible",
      severity: "warning",
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

  /**
   * Evidence stills. The load-bearing property is the prune: the worker captures
   * while a condition holds, but only the rules know which conditions survived —
   * so a still for a frame that never became an incident is a photograph of a
   * candidate the system was WRONG about, and must not be kept.
   */
  describe("attachSnapshots", () => {
    function snapshot(
      atMs: number,
      conditions: VisionIncidentType | VisionIncidentType[],
      key: string,
    ) {
      return {
        at: new Date(T0 + atMs).toISOString(),
        conditions: Array.isArray(conditions) ? conditions : [conditions],
        key,
      };
    }

    /** A row written before 2026-08-28, when a still carried one label. */
    function legacySnapshot(
      atMs: number,
      condition: VisionIncidentType,
      key: string,
    ) {
      return { at: new Date(T0 + atMs).toISOString(), condition, key };
    }

    it("attaches a still captured inside a confirmed incident", () => {
      const report = summarizeProctoring([], samples(0, 4)); // 0–30s absence
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        snapshot(10_000, "person_absent", "camp/app/1.jpg"),
      ]);

      expect(withSnaps.incidents[0].snapshot_key).toBe("camp/app/1.jpg");
      expect(orphanedKeys).toEqual([]);
    });

    it("orphans a still whose condition never cleared the threshold", () => {
      // One stray frame — never an incident, so its picture is evidence of
      // nothing and gets deleted.
      const report = summarizeProctoring([], [
        ...samples(1, 2),
        ...samples(0, 1, { startMs: 20_000 }),
      ]);
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        snapshot(20_000, "person_absent", "camp/app/stray.jpg"),
      ]);

      expect(withSnaps.incidents).toEqual([]);
      expect(orphanedKeys).toEqual(["camp/app/stray.jpg"]);
    });

    it("does not attach a still of a different condition", () => {
      const report = summarizeProctoring([], samples(0, 4));
      const { orphanedKeys } = attachSnapshots(report, [
        snapshot(10_000, "phone_visible", "camp/app/phone.jpg"),
      ]);

      expect(orphanedKeys).toEqual(["camp/app/phone.jpg"]);
    });

    it("does not attach a still taken outside the incident's window", () => {
      const report = summarizeProctoring([], samples(0, 4)); // spans 0–30s
      const { orphanedKeys } = attachSnapshots(report, [
        snapshot(120_000, "person_absent", "camp/app/late.jpg"),
      ]);

      expect(orphanedKeys).toEqual(["camp/app/late.jpg"]);
    });

    it("keeps the earliest still and orphans the rest of the same incident", () => {
      const report = summarizeProctoring([], samples(0, 8)); // 0–70s absence
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        snapshot(40_000, "person_absent", "camp/app/late.jpg"),
        snapshot(10_000, "person_absent", "camp/app/early.jpg"),
      ]);

      expect(withSnaps.incidents[0].snapshot_key).toBe("camp/app/early.jpg");
      expect(orphanedKeys).toEqual(["camp/app/late.jpg"]);
    });

    it("never attaches a still to a browser-signal incident", () => {
      const report = summarizeProctoring([event({ duration_ms: 20_000 })], []);
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        snapshot(0, "person_absent", "camp/app/1.jpg"),
      ]);

      expect(withSnaps.incidents[0].snapshot_key).toBeUndefined();
      expect(orphanedKeys).toEqual(["camp/app/1.jpg"]);
    });

    it("gives two incidents two different stills", () => {
      // Two people AND a phone throughout: two incidents, one picture each.
      const report = summarizeProctoring([], samples(2, 4, { phoneCount: 1 }));
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        snapshot(10_000, "multiple_people", "camp/app/people.jpg"),
        snapshot(10_000, "phone_visible", "camp/app/phone.jpg"),
      ]);

      const keys = withSnaps.incidents.map((i) => i.snapshot_key).sort();
      expect(keys).toEqual(["camp/app/people.jpg", "camp/app/phone.jpg"]);
      expect(orphanedKeys).toEqual([]);
    });

    /**
     * The whole reason a still now carries every condition its frame satisfied.
     * One image, two findings — the phone incident used to render with no
     * picture whenever a second person happened to share the frame, which is
     * exactly when a recruiter most needs something to check.
     */
    it("attaches one still to both incidents its frame depicts", () => {
      const report = summarizeProctoring([], samples(2, 5, { phoneCount: 1 }));
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        snapshot(5_000, ["multiple_people", "phone_visible"], "camp/app/both.jpg"),
      ]);

      const byType = Object.fromEntries(
        withSnaps.incidents.map((i) => [i.type, i.snapshot_key]),
      );
      expect(byType.multiple_people).toBe("camp/app/both.jpg");
      expect(byType.phone_visible).toBe("camp/app/both.jpg");
      // Serving two findings must not make it look unreferenced and get deleted.
      expect(orphanedKeys).toEqual([]);
    });

    it("still attaches a legacy single-label still", () => {
      const report = summarizeProctoring([], samples(0, 5));
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, [
        legacySnapshot(5_000, "person_absent", "camp/app/old.jpg"),
      ]);

      expect(withSnaps.incidents[0].snapshot_key).toBe("camp/app/old.jpg");
      expect(orphanedKeys).toEqual([]);
    });

    it("leaves a report untouched when nothing was captured", () => {
      const report = summarizeProctoring([], samples(0, 4));
      const { report: withSnaps, orphanedKeys } = attachSnapshots(report, []);

      expect(withSnaps.incidents[0].snapshot_key).toBeUndefined();
      expect(orphanedKeys).toEqual([]);
    });
  });

  /**
   * A dropped sample does not break a run — it simply isn't there — so anything
   * that discards frames the candidate was VISIBLE in can stitch two genuine
   * absences into one long false one. The worker no longer lets detection
   * strength sink a well-lit frame (see `observationConfidence` there); this
   * pins the consequence from the rule layer's side, because the two packages
   * deploy separately and only this file knows that confidence is a gate.
   */
  it("cannot stitch an absence across frames the candidate was seen in", () => {
    const seen: VisionObservation[] = [
      { at: new Date(T0).toISOString(), person_count: 0, confidence: 0.95, phone_count: 0 },
      { at: new Date(T0 + 10_000).toISOString(), person_count: 1, confidence: 0.95, phone_count: 0 },
      { at: new Date(T0 + 20_000).toISOString(), person_count: 1, confidence: 0.95, phone_count: 0 },
      { at: new Date(T0 + 30_000).toISOString(), person_count: 0, confidence: 0.95, phone_count: 0 },
    ];

    const report = summarizeProctoring([], seen);

    // Two single-frame absences, each zero-length, neither an incident.
    expect(report.incidents).toEqual([]);
    expect(report.summary.vision_sampled).toBe(true);
  });

  it("records a watched run even when every reading is unremarkable", () => {
    const report = summarizeProctoring([], samples(1, 60));

    expect(report.summary.vision_sampled).toBe(true);
    expect(report.summary.overall_severity).toBe("clean");
  });

  it("labels every incident with the evidence it came from", () => {
    const report = summarizeProctoring([event({ duration_ms: 20_000 })], samples(0, 4));

    const bySource = Object.fromEntries(report.incidents.map((i) => [i.type, i.source]));
    expect(bySource).toEqual({ tab_blur: "client", person_absent: "vision" });
  });
});
