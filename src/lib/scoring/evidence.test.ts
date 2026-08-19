import { describe, expect, it } from "vitest";
import {
  isGrounded,
  locateEvidence,
  normalizeForMatch,
  type EvidenceTurn,
} from "./evidence";

const transcript: EvidenceTurn[] = [
  { role: "agent", text: "Tell me about a system you designed." },
  { role: "candidate", text: "I rebuilt our billing pipeline to be idempotent." },
  { role: "agent", text: "What was the hardest part?" },
  { role: "candidate", text: "Backfilling six years of ledger rows without downtime." },
];

describe("normalizeForMatch", () => {
  it("forgives punctuation and spacing", () => {
    expect(normalizeForMatch("Hello,   world!")).toBe(normalizeForMatch("hello world"));
  });

  it("does not forgive different words", () => {
    expect(normalizeForMatch("hello world")).not.toBe(normalizeForMatch("hello there"));
  });
});

describe("locateEvidence", () => {
  it("finds the candidate turn a quote came from", () => {
    const found = locateEvidence("rebuilt our billing pipeline", transcript);

    expect(found).toEqual({
      turnIndex: 1,
      quote: "rebuilt our billing pipeline",
    });
  });

  it("indexes into the original transcript, agent turns included", () => {
    // Index 3, not 1 — the UI anchors onto rendered turns, and skipping the
    // interviewer's turns would land the manager on the wrong line.
    expect(locateEvidence("Backfilling six years", transcript)?.turnIndex).toBe(3);
  });

  it("matches despite punctuation differences in the quote", () => {
    expect(locateEvidence("idempotent.", transcript)?.turnIndex).toBe(1);
  });

  it("returns null for an empty quote", () => {
    expect(locateEvidence("", transcript)).toBeNull();
    expect(locateEvidence("   ", transcript)).toBeNull();
  });

  it("returns null for a quote the candidate never said", () => {
    expect(locateEvidence("I managed a team of twelve", transcript)).toBeNull();
  });

  /**
   * The interviewer's words are not evidence about the candidate. A model that
   * quotes the question back would otherwise get a link — and a score.
   */
  it("never matches the interviewer's speech", () => {
    expect(locateEvidence("What was the hardest part", transcript)).toBeNull();
  });

  /**
   * A quote stitched from two separate utterances is not something the
   * candidate said in one breath, and pointing at either half would
   * misrepresent it. No link rather than a wrong link.
   */
  it("does not locate a quote that only matches across turns", () => {
    const stitched = "idempotent Backfilling six years";

    expect(locateEvidence(stitched, transcript)).toBeNull();
  });

  it("honours a different candidate role label", () => {
    const rows: EvidenceTurn[] = [{ role: "user", text: "I shipped it in a week." }];

    expect(locateEvidence("shipped it in a week", rows, "user")?.turnIndex).toBe(0);
  });
});

describe("isGrounded", () => {
  it("accepts a quote present in the candidate's speech", () => {
    expect(isGrounded("rebuilt our billing pipeline", transcript)).toBe(true);
  });

  it("rejects an invented quote", () => {
    expect(isGrounded("I managed a team of twelve", transcript)).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(isGrounded("", transcript)).toBe(false);
  });

  it("rejects the interviewer's own words", () => {
    expect(isGrounded("What was the hardest part", transcript)).toBe(false);
  });

  /**
   * `isGrounded` stays exactly as permissive as the original backstop: a
   * cross-turn quote still counts as grounded, so adding the link feature does
   * not quietly start zeroing scores that used to stand.
   */
  it("still accepts a quote that spans two turns, unlike locateEvidence", () => {
    const stitched = "idempotent Backfilling six years";

    expect(isGrounded(stitched, transcript)).toBe(true);
    expect(locateEvidence(stitched, transcript)).toBeNull();
  });
});
