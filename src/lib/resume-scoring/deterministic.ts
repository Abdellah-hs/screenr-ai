import { z } from "zod/v4";
import {
  CriterionPrioritySchema,
  MUST_HAVE_MINIMUM_SCORE,
  type CriterionPriority,
  type ResumeCriterion,
} from "./criteria";
import {
  EvidenceLevelSchema,
  ResumeEvidenceItemSchema,
  type EvidenceLevel,
  type ResumeEvidenceItem,
} from "./evidence";
import type { ValidatedResumeEvidence } from "./validate";

/**
 * The level → score table is shared with the screening stage
 * (`@/lib/scoring/evidence-levels`) so a `strong` reading means the same number
 * wherever it was read. Re-exported so this package's public surface is
 * unchanged.
 *
 * RESUME_SCORING_RULES_VERSION below still versions the *resume* rules that
 * consume it; an edit to the shared table must bump it, exactly as before.
 */
import { EVIDENCE_LEVEL_SCORE, scoreEvidenceLevel } from "@/lib/scoring/evidence-levels";

export { EVIDENCE_LEVEL_SCORE, scoreEvidenceLevel };

/** Version of the deterministic rules below. Part of the cache key. */
export const RESUME_SCORING_RULES_VERSION = "v2_ranking_over_all_criteria";

export interface ScoredCriterion {
  id: string;
  label: string;
  priority: CriterionPriority;
  evidence_level: EvidenceLevel;
  score: number;
  evidence_items: ResumeEvidenceItem[];
  /**
   * The duration the CV stated, when it stated one.
   *
   * Never arithmetic input: no code multiplies, thresholds or adds this number,
   * and the score comes from the evidence level alone. It is not inert either,
   * and has not been since the level definitions were rewritten around counted
   * examples and duration floors (`v4_resume_evidence`) — the model reads
   * duration when *choosing* a level, so the figure informs the outcome through
   * the reading rather than beside it. Recorded so a reviewer who asks "how
   * long?" gets an answer they can check against the quotes.
   */
  extracted_relevant_months: number | null;
  notes: string | null;
}

export interface MustHaveFailure {
  criterion_label: string;
  evidence_level: EvidenceLevel;
  score: number;
  minimum_score: number;
  reason: string;
}

export interface EligibilityResult {
  eligible: boolean;
  failed_must_haves: MustHaveFailure[];
}

export interface RankingResult {
  ranking_score: number | null;
  ranked: boolean;
}

export interface DeterministicResumeScoreResult {
  eligible: boolean;
  ranking_score: number | null;
  tier: "eligible" | "ineligible";
  criteria: ScoredCriterion[];
  failed_must_haves: MustHaveFailure[];
  validation_warnings: string[];
}

/**
 * Pair each recruiter criterion with its validated evidence and turn the level
 * into a number. Index-aligned — `validateResumeEvidence` has already proved
 * the two lists match in length and order, which is why this can be a plain zip.
 */
export function scoreValidatedCriteria(
  validated: ValidatedResumeEvidence,
  criteria: ResumeCriterion[],
): ScoredCriterion[] {
  return criteria.map((criterion, i) => {
    const evidence = validated.criteria[i];
    return {
      id: criterion.id,
      label: criterion.label,
      priority: criterion.priority,
      evidence_level: evidence.evidence_level,
      score: scoreEvidenceLevel(evidence.evidence_level),
      evidence_items: evidence.evidence_items,
      extracted_relevant_months: evidence.extracted_relevant_months,
      notes: evidence.notes,
    };
  });
}

/**
 * Every must-have, checked on its own.
 *
 * There is no total here and there cannot be one: the moment must-haves are
 * summed, a surplus on one covers a shortfall on another, and "must" has
 * quietly become "mostly". Each gate passes or it doesn't, and every failure is
 * reported — not just the first — so a recruiter sees the whole gap rather than
 * fixing one criterion and rerunning to discover the next.
 */
export function evaluateEligibility(scoredCriteria: ScoredCriterion[]): EligibilityResult {
  const mustHaves = scoredCriteria.filter((criterion) => criterion.priority === "must_have");

  const failed_must_haves = mustHaves
    .filter((criterion) => criterion.score < MUST_HAVE_MINIMUM_SCORE)
    .map((criterion) => ({
      criterion_label: criterion.label,
      evidence_level: criterion.evidence_level,
      score: criterion.score,
      minimum_score: MUST_HAVE_MINIMUM_SCORE,
      reason:
        `${criterion.label} did not reach the required minimum evidence score ` +
        `(evidence level "${criterion.evidence_level}" scores ${criterion.score}, ` +
        `minimum ${MUST_HAVE_MINIMUM_SCORE}).`,
    }));

  return {
    eligible: failed_must_haves.length === 0,
    failed_must_haves,
  };
}

/**
 * The ranking number — computed only once eligibility has already passed, and
 * averaged over EVERY criterion, must-haves included.
 *
 * Ordering the ineligible is worse than useless: a ranked list invites someone
 * to read down it, and a number next to a candidate who failed a gate is an
 * invitation to argue the gate. So an ineligible candidate gets `null`, not a
 * low score.
 *
 * ## Why must-haves count here (decision 2026-08-23)
 *
 * This used to average the nice-to-haves alone, which threw away the reading
 * of the criteria the recruiter cared about *most*. Two candidates who both
 * cleared every gate were indistinguishable on the requirements: one with
 * `very_strong` evidence of years of the work and one with `strong` evidence
 * of a single project ranked identically, and the order between them was
 * decided entirely by optional extras. It also produced the pathology that
 * exposed it — a candidate meeting all three must-haves ranked 13, because the
 * only criteria in the mean were four nice-to-haves their CV barely touched.
 *
 * Including them does NOT weaken the gate, and cannot:
 *
 * - Eligibility is decided FIRST, by `evaluateEligibility`, criterion by
 *   criterion. This function is only ever reached with that answer already in
 *   hand, and it is passed in rather than re-derived.
 * - An ineligible candidate has no ranking at all, so there is no number for a
 *   surplus to inflate. **A nice-to-have still cannot repair a failed
 *   must-have** — the invariant this module exists to hold is about
 *   *eligibility*, and it is untouched. What changes is only the *order* of
 *   candidates who have already passed.
 *
 * Every criterion carries equal weight, deliberately. A must-have is not worth
 * more inside the ranking — its extra importance was already spent, in full, on
 * the gate that ends the application when it fails. Weighting it again here
 * would express the same preference twice, and reintroduce the compensating
 * arithmetic the priority model was built to avoid.
 */
export function calculateRankingScore(
  scoredCriteria: ScoredCriterion[],
  eligible: boolean,
): RankingResult {
  if (!eligible) {
    return { ranking_score: null, ranked: false };
  }

  if (scoredCriteria.length === 0) {
    return { ranking_score: 100, ranked: true };
  }

  const average =
    scoredCriteria.reduce((sum, criterion) => sum + criterion.score, 0) /
    scoredCriteria.length;

  return { ranking_score: Math.round(average), ranked: true };
}

/**
 * The whole deterministic evaluation: evidence in, auditable result out.
 *
 * Pure and total — no clock, no I/O, no randomness — so the same validated
 * evidence and the same criteria always produce a byte-identical result, which
 * is what makes the cache safe and the audit log meaningful.
 */
export function buildDeterministicResumeScore(
  validated: ValidatedResumeEvidence,
  criteria: ResumeCriterion[],
): DeterministicResumeScoreResult {
  const scoredCriteria = scoreValidatedCriteria(validated, criteria);
  const { eligible, failed_must_haves } = evaluateEligibility(scoredCriteria);
  const { ranking_score } = calculateRankingScore(scoredCriteria, eligible);

  return {
    eligible,
    ranking_score,
    tier: eligible ? "eligible" : "ineligible",
    criteria: scoredCriteria,
    failed_must_haves,
    validation_warnings: validated.warnings,
  };
}

/**
 * Human-readable summary of a result, assembled from the result itself rather
 * than asked of the model — so the words a recruiter reads can never disagree
 * with the decision the code made. The model's `extraction_summary` is appended
 * as context, clearly separated, never as the verdict.
 */
export function resumeScoreRationale(
  result: DeterministicResumeScoreResult,
  extractionSummary: string,
): string {
  const mustHaveCount = result.criteria.filter((c) => c.priority === "must_have").length;
  const niceToHaveCount = result.criteria.length - mustHaveCount;

  const headline = result.eligible
    ? `Eligible — all ${mustHaveCount} must-have criteria met. Ranking score ${result.ranking_score}, the mean evidence score across all ${result.criteria.length} criteria (${mustHaveCount} must-have, ${niceToHaveCount} nice-to-have).`
    : `Ineligible — failed ${result.failed_must_haves.length} of ${mustHaveCount} must-have criteria: ${result.failed_must_haves
        .map((f) => `${f.criterion_label} (${f.evidence_level}, scored ${f.score} vs minimum ${f.minimum_score})`)
        .join("; ")}. An ineligible candidate is not ranked.`;

  const summary = extractionSummary.trim();
  return summary ? `${headline}\n\nEvidence summary: ${summary}` : headline;
}

/**
 * Runtime schema for a persisted result.
 *
 * `resume_evaluation` is `jsonb`, so a row read back is untyped input written by
 * whatever version of this code was deployed at score time. Parsing it on read
 * means an older shape degrades to "no evaluation available" instead of
 * crashing a candidate page.
 */
export const DeterministicResumeScoreResultSchema = z.object({
  eligible: z.boolean(),
  ranking_score: z.number().nullable(),
  tier: z.enum(["eligible", "ineligible"]),
  criteria: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      priority: CriterionPrioritySchema,
      evidence_level: EvidenceLevelSchema,
      score: z.number(),
      evidence_items: z.array(ResumeEvidenceItemSchema),
      extracted_relevant_months: z.number().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  failed_must_haves: z.array(
    z.object({
      criterion_label: z.string(),
      evidence_level: EvidenceLevelSchema,
      score: z.number(),
      minimum_score: z.number(),
      reason: z.string(),
    }),
  ),
  validation_warnings: z.array(z.string()),
});

/** Parse a stored `resume_evaluation` value, or null when it isn't one. */
export function readResumeEvaluation(value: unknown): DeterministicResumeScoreResult | null {
  if (value == null) return null;
  const parsed = DeterministicResumeScoreResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
