import { describe, expect, it } from "vitest";
import { daysInStage, defaultPreviewStage, eventLabel, lastActivityLabel, relativeAge } from "./detail-view";
import {
  APPLICATION_STAGE_BUCKET,
  type ApplicationState,
} from "@/lib/constants";

const NOW = new Date("2026-08-20T12:00:00Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("daysInStage", () => {
  it("counts whole days once there is at least one", () => {
    expect(daysInStage(ago(3 * DAY + 5 * HOUR), NOW)).toBe("3d");
  });

  it("falls back to hours under a day", () => {
    expect(daysInStage(ago(5 * HOUR), NOW)).toBe("5h");
  });

  it("does not round a fresh application up to an hour", () => {
    expect(daysInStage(ago(4 * 60_000), NOW)).toBe("<1h");
  });

  it("renders an unparseable timestamp as a dash rather than NaN", () => {
    expect(daysInStage("not a date", NOW)).toBe("—");
  });
});

describe("relativeAge", () => {
  it("reads in minutes, hours, then days", () => {
    expect(relativeAge(ago(20 * 60_000), NOW)).toBe("20m ago");
    expect(relativeAge(ago(2 * HOUR), NOW)).toBe("2h ago");
    expect(relativeAge(ago(9 * DAY), NOW)).toBe("9d ago");
  });
});

describe("lastActivityLabel", () => {
  it("names the event, not the state", () => {
    expect(lastActivityLabel("screening_scored", ago(2 * HOUR), NOW)).toBe(
      "Screening scored · 2h ago",
    );
  });

  it("says an expired link went unused rather than naming the state", () => {
    expect(lastActivityLabel("screening_expired", ago(DAY), NOW)).toBe(
      "Link expired unused · 1d ago",
    );
  });

  it("falls back to a readable state name for anything unmapped", () => {
    expect(lastActivityLabel("interview_scheduling", ago(HOUR), NOW)).toBe(
      "Interview Scheduling · 1h ago",
    );
  });
});

describe("defaultPreviewStage", () => {
  it("opens on the busiest active stage", () => {
    expect(
      defaultPreviewStage({ applied: 38, screening: 31, interview: 19, rejected: 96 }),
    ).toBe("applied");
  });

  it("never opens on a terminal bucket, however large", () => {
    expect(defaultPreviewStage({ screening: 2, rejected: 400, hired: 12 })).toBe(
      "screening",
    );
  });

  it("falls back to New on an empty campaign so the section still has a name", () => {
    expect(defaultPreviewStage({})).toBe("applied");
  });
});

describe("eventLabel", () => {
  it("keeps CV capitalised — callers must not case-fold it to fit a sentence", () => {
    expect(eventLabel("screening_review_pending")).toBe("CV scored, waiting for approval");
    expect(eventLabel("processing_failed")).toBe("CV could not be read");
  });

  it("names every state, falling back to the formatted state rather than blank", () => {
    for (const state of Object.keys(APPLICATION_STAGE_BUCKET) as ApplicationState[]) {
      expect(eventLabel(state).length, state).toBeGreaterThan(0);
    }
  });
});
