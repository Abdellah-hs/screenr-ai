import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_DETAIL_TABS,
  eventLabel,
  relativeAge,
  resolveDetailTab,
} from "./detail-view";
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

describe("relativeAge", () => {
  it("reads in minutes, hours, then days", () => {
    expect(relativeAge(ago(20 * 60_000), NOW)).toBe("20m ago");
    expect(relativeAge(ago(2 * HOUR), NOW)).toBe("2h ago");
    expect(relativeAge(ago(9 * DAY), NOW)).toBe("9d ago");
  });
});

describe("eventLabel", () => {
  it("keeps CV capitalised — callers must not case-fold it to fit a sentence", () => {
    expect(eventLabel("screening_review_pending")).toBe("CV scored, waiting for approval");
  });

  // Reached when OUR side failed — an extractor timeout, a model outage, a
  // score that could not be computed. Naming the candidate's file as the
  // culprit is the same thing the ingest path used to tell them by email.
  it("does not blame the document for a failure of ours", () => {
    expect(eventLabel("processing_failed")).toBe("Processing failed");
  });

  it("names every state, falling back to the formatted state rather than blank", () => {
    for (const state of Object.keys(APPLICATION_STAGE_BUCKET) as ApplicationState[]) {
      expect(eventLabel(state).length, state).toBeGreaterThan(0);
    }
  });
});

describe("resolveDetailTab", () => {
  it("returns each known tab unchanged", () => {
    for (const t of CAMPAIGN_DETAIL_TABS) {
      expect(resolveDetailTab(t.key)).toBe(t.key);
    }
  });

  /**
   * The tab is a URL parameter, so it arrives from anywhere — a stale
   * bookmark, a hand-edited address bar, a link written before a tab was
   * renamed. None of those may render a page with no content on it.
   */
  it("falls back to Pipeline for anything it does not recognise", () => {
    for (const bad of ["setttings", "", "PIPELINE", "../etc", "1"]) {
      expect(resolveDetailTab(bad), bad).toBe("pipeline");
    }
  });

  it("falls back to Pipeline when no tab is given at all", () => {
    // Opening /campaigns/<id> with no query is the common case, and it must
    // land on the daily work rather than on configuration.
    expect(resolveDetailTab(undefined)).toBe("pipeline");
  });

  it("lists Pipeline first, because it is the default and the daily job", () => {
    expect(CAMPAIGN_DETAIL_TABS[0].key).toBe("pipeline");
  });
});
