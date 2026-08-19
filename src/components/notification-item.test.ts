import { describe, expect, it } from "vitest";
import type { RecruiterNotification } from "@/lib/data/notifications";
import { notificationHref } from "./notification-item";

function notification(
  overrides: Partial<RecruiterNotification> = {},
): RecruiterNotification {
  return {
    id: "sla:c1:screening",
    kind: "sla_breach",
    campaignId: "c1",
    campaignTitle: "AI Engineer",
    count: 4,
    stage: "screening",
    stageLabel: "Screening",
    level: "alert",
    ...overrides,
  };
}

describe("notificationHref", () => {
  /**
   * Every kind used to link at the unfiltered candidate list, so a bell that
   * said "4 candidates over SLA in Screening" dropped the recruiter into the
   * whole pipeline to work out which four.
   */
  it("deep-links an SLA breach to the overdue filter for that stage", () => {
    expect(notificationHref(notification())).toBe(
      "/campaigns/c1/candidates?overdue=1&stage=screening",
    );
  });

  it("deep-links a pending review to the pending-review filter", () => {
    expect(
      notificationHref(
        notification({ kind: "pending_review", stage: undefined, stageLabel: undefined }),
      ),
    ).toBe("/campaigns/c1/candidates?stage=pending_review");
  });

  /**
   * Neither state has a pill of its own — the table's pills are coarse pipeline
   * buckets — and `interview_expired` files under `rejected`, which would be an
   * actively misleading place to land.
   */
  it("leaves kinds with no matching filter unfiltered", () => {
    for (const kind of ["interview_expired", "awaiting_decision"] as const) {
      expect(notificationHref(notification({ kind, stage: undefined }))).toBe(
        "/campaigns/c1/candidates",
      );
    }
  });

  it("falls back to the unfiltered list when an SLA row carries no stage", () => {
    // Defensive: `stage` is optional on the view-model, and "?stage=undefined"
    // would land on a filter that matches nothing.
    expect(notificationHref(notification({ stage: undefined }))).toBe(
      "/campaigns/c1/candidates",
    );
  });
});
