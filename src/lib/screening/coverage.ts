/**
 * Screening question **coverage** — a configuration-quality check, and nothing
 * to do with scoring.
 *
 * It answers one question: do the current questions give a candidate a
 * reasonable opportunity to demonstrate every rubric dimension? A dimension no
 * question goes looking for scores 0 for every candidate who ever applies, and
 * that 0 enters the weighted total as though they had failed it — when in truth
 * nobody asked.
 *
 * Kept rigorously apart from `src/lib/screening-scoring/`:
 *
 * - Coverage never assigns a score, a rung, a weight or a threshold.
 * - Coverage never narrows what the scorer reads. Evidence is still searched
 *   across the WHOLE transcript, because a candidate who demonstrates a
 *   competency while answering some other question has still demonstrated it.
 * - A stored score is never revisited because coverage later changed its mind.
 *
 * The model's part is semantic judgement only ("does anything here probe this?").
 * Everything that could be wrong in a way that matters — an id that is not in
 * the rubric, a dimension the model forgot, a question list that is empty — is
 * settled here, in pure functions, with no network and no clock.
 */

/** A rubric dimension, as the coverage check sees it. Name and id, no weight. */
export interface CoverageDimension {
  id: string;
  name: string;
}

export interface UncoveredDimension {
  dimensionId: string;
  dimensionName: string;
  /** Why it looks uncovered, in the recruiter's words. */
  reason: string;
}

export interface ScreeningCoverageResult {
  uncoveredDimensions: UncoveredDimension[];
}

/** What the model is allowed to say: an id and a reason. Never a score. */
export interface ReportedGap {
  dimension_id: string;
  reason: string;
}

/**
 * Reconcile what the model reported against the rubric it was given.
 *
 * Three corrections, and each exists because the opposite behaviour would be
 * worse than useless:
 *
 * - **An id that is not in the rubric is dropped.** A warning naming a
 *   dimension the recruiter cannot find is a warning they cannot act on, and it
 *   teaches them to ignore the next one.
 * - **A dimension the model did not mention counts as covered.** Silence is not
 *   evidence of a gap, and this check is deliberately conservative: its job is
 *   to catch the obvious hole, not to police interview technique.
 * - **The name comes from the rubric, never from the model.** The model is
 *   quoting a list it was handed; if the two ever disagree, the recruiter's own
 *   wording is the one they will recognise.
 *
 * Duplicates collapse to the first mention, so a model that lists a dimension
 * twice cannot make one gap look like two.
 */
export function reconcileCoverage(
  reported: ReportedGap[],
  dimensions: CoverageDimension[],
): ScreeningCoverageResult {
  const byId = new Map(dimensions.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const uncoveredDimensions: UncoveredDimension[] = [];

  for (const gap of reported) {
    const dimension = byId.get(gap.dimension_id);
    if (!dimension || seen.has(dimension.id)) continue;
    seen.add(dimension.id);
    uncoveredDimensions.push({
      dimensionId: dimension.id,
      dimensionName: dimension.name,
      reason: gap.reason.trim(),
    });
  }

  // Rubric order, not the order the model happened to answer in — the warning
  // reads alongside the rubric the recruiter is looking at.
  const order = new Map(dimensions.map((d, i) => [d.id, i]));
  uncoveredDimensions.sort(
    (a, b) => (order.get(a.dimensionId) ?? 0) - (order.get(b.dimensionId) ?? 0),
  );

  return { uncoveredDimensions };
}

/**
 * The answer when there are no questions at all, decided in code.
 *
 * No model is needed to know that nothing cannot probe something, and asking
 * one invites it to be agreeable about an empty list. The same reasoning as the
 * silent-transcript backstop in scoring: where the answer is certain, do not
 * give a model the chance to disagree with it.
 */
export function coverageWithoutQuestions(
  dimensions: CoverageDimension[],
): ScreeningCoverageResult {
  return {
    uncoveredDimensions: dimensions.map((d) => ({
      dimensionId: d.id,
      dimensionName: d.name,
      reason: "There are no screening questions yet.",
    })),
  };
}

/**
 * A stable fingerprint of the inputs a coverage result belongs to.
 *
 * The caller holds a result and this key together, so it can tell "already
 * checked" from "checked something else" without re-calling the model on every
 * render. Names and prompts are what the model actually reads, so renaming a
 * dimension or rewording a question invalidates the result — while reordering
 * questions does not, because it changes nothing about what is asked.
 */
export function coverageSignature(
  dimensions: CoverageDimension[],
  questions: { prompt: string }[],
): string {
  const dims = dimensions
    .map((d) => `${d.id}:${d.name.trim().toLowerCase()}`)
    .sort()
    .join("|");
  const qs = questions
    .map((q) => q.prompt.trim().toLowerCase())
    .filter((p) => p.length > 0)
    .sort()
    .join("|");
  return `${dims}##${qs}`;
}

/**
 * The blocker sentences for a coverage result, in the recruiter's words.
 *
 * Hedged on purpose — "appears to", not "does not". This is a model's reading
 * and it can be wrong, so the wording must not assert more than was established.
 * The consequence is stated plainly because it is the part that is certain: an
 * unprobed dimension really does score zero for everyone.
 *
 * Each sentence ends with the way out, because there is no longer a "continue
 * anyway" — a blocker with no stated remedy is a dead end, and the two remedies
 * here are both a few seconds' work.
 */
export function coverageBlockers(coverage: ScreeningCoverageResult): string[] {
  return coverage.uncoveredDimensions.map(
    (d) =>
      `No question appears to ask candidates about "${d.dimensionName}", so it would ` +
      `score zero for everyone. Add a question that covers it, or remove it from the rubric.`,
  );
}
