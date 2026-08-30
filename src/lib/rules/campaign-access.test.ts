import { describe, it, expect } from "vitest";

import {
  canDecideOnCampaign,
  canDeleteCampaign,
  canManageCampaign,
  meetsCampaignRole,
  type CampaignAccessRole,
} from "./campaign-access";

const EVERY_ROLE: CampaignAccessRole[] = ["observer", "reviewer", "lead", "owner"];

describe("meetsCampaignRole", () => {
  it("treats a null role as no membership at all", () => {
    expect(meetsCampaignRole(null, "observer")).toBe(false);
  });

  it("lets every role meet its own minimum", () => {
    for (const role of EVERY_ROLE) {
      expect(meetsCampaignRole(role, role)).toBe(true);
    }
  });

  it("lets a higher role meet a lower minimum", () => {
    expect(meetsCampaignRole("owner", "observer")).toBe(true);
    expect(meetsCampaignRole("lead", "reviewer")).toBe(true);
  });

  it("refuses a lower role against a higher minimum", () => {
    expect(meetsCampaignRole("observer", "reviewer")).toBe(false);
    expect(meetsCampaignRole("reviewer", "lead")).toBe(false);
    expect(meetsCampaignRole("lead", "owner")).toBe(false);
  });
});

describe("canDecideOnCampaign", () => {
  /**
   * The load-bearing assertion of issue #132. A read-only role that can
   * transition an application is not read-only, and `observer` named a rule
   * that did not exist for as long as no policy referenced the table.
   */
  it("refuses an observer", () => {
    expect(canDecideOnCampaign("observer")).toBe(false);
  });

  it("allows a reviewer, a lead and the owner", () => {
    expect(canDecideOnCampaign("reviewer")).toBe(true);
    expect(canDecideOnCampaign("lead")).toBe(true);
    expect(canDecideOnCampaign("owner")).toBe(true);
  });

  it("refuses a non-member", () => {
    expect(canDecideOnCampaign(null)).toBe(false);
  });
});

describe("canManageCampaign", () => {
  /**
   * Deciding about one candidate is not the authority to change the rubric
   * everyone is judged against — so this is strictly narrower than deciding.
   */
  it("refuses a plain reviewer", () => {
    expect(canManageCampaign("reviewer")).toBe(false);
    expect(canDecideOnCampaign("reviewer")).toBe(true);
  });

  it("allows a lead and the owner", () => {
    expect(canManageCampaign("lead")).toBe(true);
    expect(canManageCampaign("owner")).toBe(true);
  });

  it("refuses an observer and a non-member", () => {
    expect(canManageCampaign("observer")).toBe(false);
    expect(canManageCampaign(null)).toBe(false);
  });
});

describe("canDeleteCampaign", () => {
  it("allows only the owner, not even a lead", () => {
    expect(canDeleteCampaign("owner")).toBe(true);
    expect(canDeleteCampaign("lead")).toBe(false);
  });
});

describe("the ladder as a whole", () => {
  /**
   * Every capability must be monotonic in the ladder: if a role can do
   * something, every role above it can too. A gap would mean the single
   * ordering is the wrong model, and would let a lead be refused something a
   * reviewer is allowed.
   */
  it("never grants a capability that a higher role lacks", () => {
    const capabilities = [canDecideOnCampaign, canManageCampaign, canDeleteCampaign];

    for (const can of capabilities) {
      const granted = EVERY_ROLE.map(can);
      const firstGrant = granted.indexOf(true);
      if (firstGrant === -1) continue;
      expect(granted.slice(firstGrant).every(Boolean)).toBe(true);
    }
  });
});
