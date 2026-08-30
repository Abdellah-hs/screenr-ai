import { EVIDENCE_LEVEL_SCORE, type EvidenceLevel } from "@/lib/resume-scoring";

/**
 * The cheapest evidence level that would clear a given bar.
 *
 * A failed must-have leaves the reader with "why not?" answered — the level and
 * its definition are right there — and "what would have been enough?" not. That
 * second question is the one a recruiter actually acts on, because it says
 * whether the model read the CV too harshly or the CV genuinely lacks the
 * evidence.
 *
 * Derived from the score table rather than hard-coded to `strong`: the levels
 * and the gate are both tunable, and a hand-written answer here would quietly
 * stop being true the moment either moved. Returns null when nothing clears the
 * bar at all, which is only reachable if the bar is set above 100.
 */
export function firstLevelClearing(minimumScore: number): EvidenceLevel | null {
  const ladder = Object.entries(EVIDENCE_LEVEL_SCORE) as [EvidenceLevel, number][];
  return ladder.find(([, score]) => score >= minimumScore)?.[0] ?? null;
}
