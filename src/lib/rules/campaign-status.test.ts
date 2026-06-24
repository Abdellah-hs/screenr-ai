import { describe, it, expect } from "vitest";
import {
  settableCampaignStatuses,
  commonSettableCampaignStatuses,
  isCampaignProcessingActive,
  assertCampaignActive,
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

describe("assertCampaignActive", () => {
  it("does not throw for an active campaign", () => {
    expect(() => assertCampaignActive("active")).not.toThrow();
  });

  it("throws for a non-active campaign, naming the status", () => {
    expect(() => assertCampaignActive("draft")).toThrow(/this campaign is draft/i);
    expect(() => assertCampaignActive("paused")).toThrow(/paused/);
  });
});
