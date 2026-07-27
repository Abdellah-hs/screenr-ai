import { describe, it, expect } from "vitest";
import {
  settableCampaignStatuses,
  commonSettableCampaignStatuses,
  isCampaignProcessingActive,
  isDeadlinePassed,
  isCampaignAcceptingApplications,
  decodeStatusSelection,
  encodeStatusSelection,
  settableStatusSelections,
  assertCampaignActive,
  type CampaignApplyGate,
} from "./campaign-status";

describe("settableCampaignStatuses", () => {
  it("offers every status except the current one", () => {
    expect(settableCampaignStatuses("draft")).toEqual([
      "active",
      "paused",
      "closed",
    ]);
  });

  it("lets a closed campaign move anywhere, including back to draft/active", () => {
    expect(settableCampaignStatuses("closed")).toEqual([
      "draft",
      "active",
      "paused",
    ]);
  });
});

describe("commonSettableCampaignStatuses", () => {
  it("excludes only the shared status for a same-status selection", () => {
    expect(commonSettableCampaignStatuses(["draft", "draft"])).toEqual([
      "active",
      "paused",
      "closed",
    ]);
  });

  it("offers every status for a mixed selection (so select-all always works)", () => {
    expect(commonSettableCampaignStatuses(["draft", "active"])).toEqual([
      "draft",
      "active",
      "paused",
      "closed",
    ]);
  });

  it("returns nothing for an empty selection", () => {
    expect(commonSettableCampaignStatuses([])).toEqual([]);
  });
});

describe("isCampaignProcessingActive", () => {
  it("is true only for active", () => {
    expect(isCampaignProcessingActive("active")).toBe(true);
  });

  it("is false for draft / paused / closed (frozen)", () => {
    for (const s of ["draft", "paused", "closed"] as const) {
      expect(isCampaignProcessingActive(s)).toBe(false);
    }
  });
});

describe("isDeadlinePassed", () => {
  const deadline = "2026-07-25T00:00:00.000Z";

  it("is false for a null deadline", () => {
    expect(isDeadlinePassed(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("is false during the deadline day itself (inclusive)", () => {
    expect(isDeadlinePassed(deadline, new Date("2026-07-25T23:59:59.999Z"))).toBe(false);
  });

  it("is true from the start of the day after the deadline", () => {
    expect(isDeadlinePassed(deadline, new Date("2026-07-26T00:00:00.000Z"))).toBe(true);
  });

  it("is false for an unparseable deadline string", () => {
    expect(isDeadlinePassed("not-a-date", new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("isCampaignAcceptingApplications", () => {
  const now = new Date("2026-07-26T12:00:00Z"); // a day past the deadline below
  const pastDeadline = "2026-07-25T00:00:00.000Z";

  // Default gate: active, intake open, no enforced deadline (accepts).
  function gate(over: Partial<CampaignApplyGate> = {}): CampaignApplyGate {
    return {
      status: "active",
      accepting_applications: true,
      deadline: null,
      deadline_enforced: false,
      ...over,
    };
  }

  it("is false when the campaign is not active, regardless of everything else", () => {
    expect(isCampaignAcceptingApplications(gate({ status: "paused" }), now)).toBe(false);
  });

  it("is false when active but the manual intake switch is off", () => {
    expect(
      isCampaignAcceptingApplications(gate({ accepting_applications: false }), now),
    ).toBe(false);
  });

  it("accepts when active, intake on, and the deadline is not enforced (even if passed)", () => {
    expect(
      isCampaignAcceptingApplications(gate({ deadline: pastDeadline }), now),
    ).toBe(true);
  });

  it("blocks when active, intake on, the deadline is enforced, and it has passed", () => {
    expect(
      isCampaignAcceptingApplications(
        gate({ deadline: pastDeadline, deadline_enforced: true }),
        now,
      ),
    ).toBe(false);
  });

  it("accepts when active, intake on, and the enforced deadline has not passed yet", () => {
    expect(
      isCampaignAcceptingApplications(
        gate({ deadline: "2026-08-01T00:00:00.000Z", deadline_enforced: true }),
        now,
      ),
    ).toBe(true);
  });
});

describe("decodeStatusSelection", () => {
  it("maps active_no_intake to active + intake closed", () => {
    expect(decodeStatusSelection("active_no_intake")).toEqual({
      status: "active",
      accepting_applications: false,
    });
  });

  it("maps a plain active to active + intake open", () => {
    expect(decodeStatusSelection("active")).toEqual({
      status: "active",
      accepting_applications: true,
    });
  });

  it("passes through the other lifecycle statuses with intake open", () => {
    for (const s of ["draft", "paused", "closed"] as const) {
      expect(decodeStatusSelection(s)).toEqual({ status: s, accepting_applications: true });
    }
  });

  it("falls back to draft for an unknown value", () => {
    expect(decodeStatusSelection("garbage")).toEqual({
      status: "draft",
      accepting_applications: true,
    });
  });
});

describe("settableStatusSelections", () => {
  it("offers all five options except the current one", () => {
    expect(settableStatusSelections("active")).toEqual([
      "draft",
      "active_no_intake",
      "paused",
      "closed",
    ]);
  });

  it("excludes active_no_intake when that's the current selection", () => {
    expect(settableStatusSelections("active_no_intake")).toEqual([
      "draft",
      "active",
      "paused",
      "closed",
    ]);
  });
});

describe("encodeStatusSelection", () => {
  it("encodes active + intake closed as active_no_intake", () => {
    expect(encodeStatusSelection("active", false)).toBe("active_no_intake");
  });

  it("encodes active + intake open as active", () => {
    expect(encodeStatusSelection("active", true)).toBe("active");
  });

  it("ignores the flag for non-active statuses", () => {
    expect(encodeStatusSelection("paused", false)).toBe("paused");
    expect(encodeStatusSelection("draft", true)).toBe("draft");
  });
});

describe("assertCampaignActive", () => {
  it("does not throw for an active campaign", () => {
    expect(() => assertCampaignActive("active")).not.toThrow();
  });

  it("throws for a non-active campaign, naming the status", () => {
    expect(() => assertCampaignActive("draft")).toThrow(/this campaign is draft/i);
    expect(() => assertCampaignActive("paused")).toThrow(/paused/);
  });
});
