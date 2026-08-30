import { describe, expect, it } from "vitest";
import { EMPTY_TALENT_POOL_FILTERS, type TalentPoolFilters } from "@/lib/constants";
import {
  activePoolFilterChips,
  formatPoolAdded,
  hasPoolNarrowing,
  poolCountLabel,
  poolInitials,
} from "./view";

function filters(patch: Partial<TalentPoolFilters> = {}): TalentPoolFilters {
  return { ...EMPTY_TALENT_POOL_FILTERS, ...patch };
}

describe("poolInitials", () => {
  it("takes the first and last name", () => {
    expect(poolInitials("Abdellah Hasnaoui", "a@b.com")).toBe("AH");
  });

  it("uses one letter for a single-word name", () => {
    expect(poolInitials("Cher", "a@b.com")).toBe("C");
  });

  it("skips the middle name rather than crowding the circle", () => {
    expect(poolInitials("Ada Byron Lovelace", "a@b.com")).toBe("AL");
  });

  it("falls back to the email when there is no name at all", () => {
    expect(poolInitials("   ", "zoe@example.com")).toBe("Z");
  });
});

describe("hasPoolNarrowing", () => {
  it("is false for an untouched filter set", () => {
    expect(hasPoolNarrowing(filters())).toBe(false);
  });

  it("ignores the search box, which is always visible on its own", () => {
    expect(hasPoolNarrowing(filters({ query: "python" }))).toBe(false);
  });

  it.each([
    ["tags", { tags: ["backend"] }],
    ["campaign", { campaignId: "c1" }],
    ["minimum score", { minScore: 60 }],
    ["maximum score", { maxScore: 80 }],
    ["added from", { addedFrom: "2026-08-01" }],
    ["added to", { addedTo: "2026-08-20" }],
  ])("is true when %s narrows the list", (_axis, patch) => {
    expect(hasPoolNarrowing(filters(patch))).toBe(true);
  });
});

describe("poolCountLabel", () => {
  it("gives a plain count when nothing is narrowing", () => {
    expect(poolCountLabel(12, 12, false)).toBe("12 people");
    expect(poolCountLabel(1, 1, false)).toBe("1 person");
  });

  it("gives the ratio once something is", () => {
    expect(poolCountLabel(3, 12, true)).toBe("3 of 12 people");
  });

  it("says no matches rather than '0 of 12'", () => {
    expect(poolCountLabel(0, 12, true)).toBe("No matches");
  });
});

describe("activePoolFilterChips", () => {
  it("returns nothing when nothing is narrowing", () => {
    expect(activePoolFilterChips(filters())).toEqual([]);
  });

  it("ignores the search box", () => {
    expect(activePoolFilterChips(filters({ query: "kafka" }))).toEqual([]);
  });

  it("gives one chip per tag, carrying the tag it drops", () => {
    const chips = activePoolFilterChips(filters({ tags: ["backend", "senior"] }));

    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject({ kind: "tag", label: "backend", tag: "backend" });
    expect(chips[1]).toMatchObject({ kind: "tag", label: "senior", tag: "senior" });
  });

  it("names the campaign it was given a title for", () => {
    const chips = activePoolFilterChips(
      filters({ campaignId: "c1" }),
      new Map([["c1", "Data scientist"]]),
    );

    expect(chips[0]).toMatchObject({ kind: "campaign", label: "Campaign: Data scientist" });
  });

  it("still names a campaign whose entry has since left the pool", () => {
    const chips = activePoolFilterChips(filters({ campaignId: "gone" }));

    expect(chips[0].label).toBe("Campaign: Unknown campaign");
  });

  it("keeps a score range as one chip, however it was bounded", () => {
    expect(activePoolFilterChips(filters({ minScore: 60, maxScore: 80 }))[0].label).toBe(
      "Best 60–80",
    );
    expect(activePoolFilterChips(filters({ minScore: 60 }))[0].label).toBe("Best 60+");
    expect(activePoolFilterChips(filters({ maxScore: 80 }))[0].label).toBe("Best up to 80");
  });

  it("keeps a date range as one chip and does not reformat the dates", () => {
    expect(
      activePoolFilterChips(filters({ addedFrom: "2026-08-01", addedTo: "2026-08-20" }))[0].label,
    ).toBe("Added 2026-08-01 – 2026-08-20");
    expect(activePoolFilterChips(filters({ addedFrom: "2026-08-01" }))[0].label).toBe(
      "Added from 2026-08-01",
    );
    expect(activePoolFilterChips(filters({ addedTo: "2026-08-20" }))[0].label).toBe(
      "Added until 2026-08-20",
    );
  });

  it("lists every active axis at once", () => {
    const chips = activePoolFilterChips(
      filters({ tags: ["backend"], campaignId: "c1", minScore: 70, addedFrom: "2026-08-01" }),
      new Map([["c1", "Data scientist"]]),
    );

    expect(chips.map((c) => c.kind)).toEqual(["tag", "campaign", "score", "added"]);
  });
});

describe("formatPoolAdded", () => {
  it("reads as a date a person would say out loud", () => {
    expect(formatPoolAdded("2026-08-23T10:15:00.000Z", "UTC")).toBe("23 Aug 2026");
  });

  it("does not throw on a value that is not a date", () => {
    expect(formatPoolAdded("nonsense")).toBe("an unknown date");
  });
});
