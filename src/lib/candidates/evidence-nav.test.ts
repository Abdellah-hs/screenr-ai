import { describe, expect, it } from "vitest";
import {
  CANDIDATE_DETAIL_TABS,
  DEFAULT_CANDIDATE_TAB,
  DEFAULT_EVIDENCE_VIEW,
  EVIDENCE_VIEWS,
  candidateDetailHref,
  evidenceNavTree,
  resolveCandidateTab,
  resolveEvidenceView,
  type EvidenceNavInput,
  type EvidenceNavNode,
} from "./evidence-nav";
import type { CandidateScore } from "@/lib/constants";

function score(
  stage: CandidateScore["stage"],
  overall: number | null,
): CandidateScore {
  return {
    stage,
    overall,
    tier: "strong",
    ai_summary: "",
    factors: [],
    evaluation: null,
    scored_at: "2026-08-14T08:57:00.000Z",
    rubric_version: 3,
    current_rubric_version: 3,
  };
}

function input(patch: Partial<EvidenceNavInput> = {}): EvidenceNavInput {
  return {
    scores: [],
    status: "screening_scored",
    screeningProctored: false,
    interviewProctored: false,
    thresholds: { resume: 70, screening: 60 },
    ...patch,
  };
}

const find = (tree: EvidenceNavNode[], label: string): EvidenceNavNode | undefined =>
  tree.find((node) => node.label === label);

describe("resolveEvidenceView", () => {
  it("accepts every view it advertises", () => {
    for (const view of EVIDENCE_VIEWS) {
      expect(resolveEvidenceView(view)).toBe(view);
    }
  });

  it("opens on the CV when no view is named", () => {
    expect(resolveEvidenceView(undefined)).toBe(DEFAULT_EVIDENCE_VIEW);
    expect(DEFAULT_EVIDENCE_VIEW).toBe("cv");
  });

  it("falls back rather than rendering nothing for an unknown view", () => {
    expect(resolveEvidenceView("proctoring")).toBe(DEFAULT_EVIDENCE_VIEW);
    expect(resolveEvidenceView("")).toBe(DEFAULT_EVIDENCE_VIEW);
  });

  it("ignores a repeated param, which arrives as an array", () => {
    expect(resolveEvidenceView(["interview", "screening"])).toBe(DEFAULT_EVIDENCE_VIEW);
  });

  it("lands a stale ?view=history link on something rather than nothing", () => {
    expect(resolveEvidenceView("history")).toBe(DEFAULT_EVIDENCE_VIEW);
  });
});

describe("evidenceNavTree", () => {
  it("lists the three stages, in pipeline order, and nothing else", () => {
    const tree = evidenceNavTree(input());

    expect(tree.map((node) => node.label)).toEqual(["CV", "Screening", "Interview"]);
  });

  it("keeps the audit trail out of the evidence entirely — it is a page tab", () => {
    expect(evidenceNavTree(input()).map((n) => n.view)).not.toContain("history");
    expect(EVIDENCE_VIEWS).not.toContain("history");
    expect(CANDIDATE_DETAIL_TABS.map((t) => t.key)).toContain("history");
  });

  it("keeps the parsed CV out of the evidence views — it is a page tab", () => {
    const cv = find(evidenceNavTree(input()), "CV");

    expect(cv?.view).toBe("cv");
    expect(cv?.children).toEqual([]);
    expect(EVIDENCE_VIEWS).not.toContain("cv-parsed");
  });

  it("gives each live stage its own proctoring sub-item", () => {
    const tree = evidenceNavTree(input());

    expect(find(tree, "Screening")?.children.map((c) => c.view)).toEqual([
      "screening-proctoring",
    ]);
    expect(find(tree, "Interview")?.children.map((c) => c.view)).toEqual([
      "interview-proctoring",
    ]);
  });

  it("carries each stage's score on the parent row", () => {
    const tree = evidenceNavTree(
      input({ scores: [score("resume", 46), score("screening", 84)] }),
    );

    expect(find(tree, "CV")?.meta).toBe("46");
    expect(find(tree, "Screening")?.meta).toBe("84");
  });

  it("marks a stage with no score as quiet, not as a zero", () => {
    const tree = evidenceNavTree(input({ scores: [score("resume", 46)] }));

    expect(find(tree, "Interview")).toMatchObject({ meta: "—", quiet: true });
  });

  it("keeps an ineligible resume quiet — it is never ranked", () => {
    const tree = evidenceNavTree(input({ scores: [score("resume", null)] }));

    expect(find(tree, "CV")).toMatchObject({ meta: "—", quiet: true });
  });

  it("quiets a proctoring row nothing was captured for, and only that one", () => {
    const tree = evidenceNavTree(input({ interviewProctored: true }));

    expect(find(tree, "Screening")?.children[0].quiet).toBe(true);
    expect(find(tree, "Interview")?.children[0].quiet).toBe(false);
  });

  it("names the absence on a stage the pipeline reached but never scored", () => {
    const tree = evidenceNavTree(
      input({ scores: [score("resume", 62)], status: "screening_expired" }),
    );

    expect(find(tree, "Screening")).toMatchObject({
      caption: "Screening expired",
      captionTone: "lapsed",
    });
  });

  it("still captions a stage still ahead of the candidate, but quietly", () => {
    const tree = evidenceNavTree(input({ status: "screening_review_pending" }));

    expect(find(tree, "Interview")).toMatchObject({
      caption: "Not reached yet",
      captionTone: "upcoming",
    });
  });

  it("gives every stage a caption, so no tile renders a blank line", () => {
    const tree = evidenceNavTree(input({ scores: [score("resume", 62)] }));

    for (const node of tree) {
      expect(node.caption).toBeTruthy();
    }
  });

  it("captions a scored stage with its tier rather than the number again", () => {
    const tree = evidenceNavTree(input({ scores: [score("resume", 62)] }));

    expect(find(tree, "CV")).toMatchObject({
      meta: "62",
      caption: "Strong",
      captionTone: "reading",
    });
  });

  it("names a stage's own half only where a sub-switch has to label it", () => {
    const tree = evidenceNavTree(input());

    expect(find(tree, "CV")?.selfLabel).toBeNull();
    expect(find(tree, "Screening")?.selfLabel).toBe("The call");
    expect(find(tree, "Interview")?.selfLabel).toBe("The interview");
  });

  it("tells a lapse apart from a stage that is simply still in flight", () => {
    const waiting = evidenceNavTree(
      input({ scores: [score("resume", 62)], status: "screening_sent" }),
    );
    const dead = evidenceNavTree(
      input({ scores: [score("resume", 62)], status: "screening_expired" }),
    );

    expect(find(waiting, "Screening")?.captionTone).toBe("pending");
    expect(find(dead, "Screening")?.captionTone).toBe("lapsed");
  });

  it("blames the lapse on the stage it happened in, not on every earlier one", () => {
    const tree = evidenceNavTree(input({ status: "screening_expired" }));

    // The CV was never scored either, but nothing expired there.
    expect(find(tree, "CV")?.captionTone).toBe("pending");
    expect(find(tree, "Screening")?.captionTone).toBe("lapsed");
  });

  it("measures each stage against its own bar, never a shared one", () => {
    const tree = evidenceNavTree(
      input({
        scores: [score("resume", 65), score("screening", 65)],
        thresholds: { resume: 70, screening: 60 },
      }),
    );

    expect(find(tree, "CV")?.meter).toMatchObject({ threshold: 70, clears: false });
    expect(find(tree, "Screening")?.meter).toMatchObject({
      threshold: 60,
      clears: true,
    });
  });

  it("says a missed resume bar rejects and a missed screening bar only holds", () => {
    const tree = evidenceNavTree(
      input({ scores: [score("resume", 10), score("screening", 10)] }),
    );

    expect(find(tree, "CV")?.meter?.miss).toBe("rejects");
    expect(find(tree, "Screening")?.meter?.miss).toBe("holds");
  });

  it("gives the interview no bar at all — it never rejects at any threshold", () => {
    const tree = evidenceNavTree(input({ scores: [score("interview", 42)] }));

    expect(find(tree, "Interview")?.meter).toMatchObject({
      score: 42,
      threshold: null,
      clears: null,
      miss: null,
    });
  });

  it("gives an unscored stage no meter, so nothing reads as how close they came", () => {
    const tree = evidenceNavTree(input({ scores: [score("resume", 62)] }));

    expect(find(tree, "Screening")?.meter).toBeNull();
    expect(find(tree, "Interview")?.meter).toBeNull();
  });

  it("gives an ineligible resume no meter — it is never ranked", () => {
    const tree = evidenceNavTree(input({ scores: [score("resume", null)] }));

    expect(find(tree, "CV")?.meter).toBeNull();
  });

  it("counts a score exactly on the bar as clearing it", () => {
    const tree = evidenceNavTree(
      input({ scores: [score("resume", 70)], thresholds: { resume: 70, screening: 60 } }),
    );

    expect(find(tree, "CV")?.meter?.clears).toBe(true);
  });

  it("points every row at a view that exists", () => {
    const tree = evidenceNavTree(input());
    const views = tree.flatMap((node) => [
      node.view,
      ...node.children.map((c) => c.view),
    ]);

    for (const view of views) {
      expect(EVIDENCE_VIEWS).toContain(view);
    }
  });
});

describe("resolveCandidateTab", () => {
  it("accepts every tab it advertises", () => {
    for (const tab of CANDIDATE_DETAIL_TABS) {
      expect(resolveCandidateTab(tab.key)).toBe(tab.key);
    }
  });

  it("lists the CV first, and opens on it", () => {
    expect(CANDIDATE_DETAIL_TABS.map((t) => t.key)).toEqual([
      "parsed",
      "evidence",
      "history",
    ]);
    expect(DEFAULT_CANDIDATE_TAB).toBe("parsed");
    expect(resolveCandidateTab(undefined)).toBe("parsed");
  });

  it("falls back rather than rendering nothing for an unknown tab", () => {
    expect(resolveCandidateTab("cv-parsed")).toBe(DEFAULT_CANDIDATE_TAB);
    expect(resolveCandidateTab(["parsed", "evidence"])).toBe(DEFAULT_CANDIDATE_TAB);
  });
});

describe("candidateDetailHref", () => {
  const base = "/campaigns/c1/candidates/a1";

  it("keeps the evidence tab when selecting an evidence view", () => {
    const href = candidateDetailHref(base, "evidence", "screening");

    expect(href).toBe(`${base}?tab=evidence&view=screening`);
  });

  it("lands every evidence view back on the evidence tab", () => {
    for (const view of EVIDENCE_VIEWS) {
      const href = candidateDetailHref(base, "evidence", view);
      const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));

      expect(resolveCandidateTab(query.get("tab") ?? undefined)).toBe("evidence");
      expect(resolveEvidenceView(query.get("view") ?? undefined)).toBe(view);
    }
  });

  it("carries the evidence selection across a trip to the parsed CV", () => {
    const href = candidateDetailHref(base, "parsed", "interview-proctoring");
    const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));

    expect(resolveCandidateTab(query.get("tab") ?? undefined)).toBe("parsed");
    expect(resolveEvidenceView(query.get("view") ?? undefined)).toBe(
      "interview-proctoring",
    );
  });

  it("omits the default tab so a bare candidate URL stays canonical", () => {
    expect(candidateDetailHref(base, DEFAULT_CANDIDATE_TAB, DEFAULT_EVIDENCE_VIEW)).toBe(
      `${base}?view=cv`,
    );
  });
});
