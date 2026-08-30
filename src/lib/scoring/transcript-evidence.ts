import { z } from "zod/v4";
import { normalizedIncludes } from "./quotes";
import { EvidenceLevelSchema, type EvidenceLevel } from "./evidence-levels";

/**
 * The shape a model may report evidence in, and the check that corrects it.
 *
 * Shared by voice screening and the AI interview. Both grade speech against a
 * weighted rubric, and the rules for what a model is allowed to claim — and
 * what happens when it cannot back a claim up — must not differ between them:
 * a `strong` that survives verification at one stage and not at the other would
 * make the shared ladder in `evidence-levels.ts` a fiction.
 *
 * What each level MEANS is deliberately not here. A CV proves a skill one way,
 * a screening answer another, a full interview another still, so each stage
 * owns its own definitions and its own prompt.
 */

export const EvidenceItemSchema = z.object({
  /** Copied verbatim from the candidate's speech. Verified against the transcript later. */
  quote: z.string(),
  /**
   * Which transcript turn the quote came from. Advisory: verification searches
   * the candidate's speech as a whole, because a model that reads the right
   * words out of the right answer but miscounts the turn index has still found
   * the evidence.
   */
  turn_index: z.number().nullable(),
  explanation: z.string(),
});

/**
 * One finding, about one rubric dimension.
 *
 * Keyed on the dimension, not on the question that happened to elicit it. The
 * rubric is what the recruiter decided the role needs; the questions are only
 * how the conversation goes looking for it. A candidate who answers question 2
 * with material that proves dimension 4 has proved dimension 4, and scoring per
 * question could not see that — it graded the eliciting turn rather than the
 * competency, and gave a dimension covered by two questions twice the say of
 * one covered by a single question, purely by accident of phrasing.
 */
export const DimensionEvidenceSchema = z.object({
  dimension_id: z.string(),
  evidence_level: EvidenceLevelSchema,
  evidence_items: z.array(EvidenceItemSchema),
  notes: z.string().nullable(),
});

export const EvidenceResponseSchema = z.object({
  dimensions: z.array(DimensionEvidenceSchema),
  extraction_summary: z.string(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type DimensionEvidence = z.infer<typeof DimensionEvidenceSchema>;
export type EvidenceResponse = z.infer<typeof EvidenceResponseSchema>;

/**
 * The level a dimension gets when the conversation produced nothing on it.
 *
 * Distinct from every other path into `not_present`: this one is decided by
 * code, from the transcript itself, and is not the model's to overturn.
 */
export const UNANSWERED_LEVEL: EvidenceLevel = "not_present";

/**
 * The level an unconfirmed claim collapses to.
 *
 * `unclear` rather than `not_present` because the two say different things and
 * only one of them is honest here: `not_present` asserts the conversation
 * produced nothing on the topic, which we have not established — we established
 * that the *quote* could not be found in the candidate's speech. Both score 0,
 * so the candidate is treated identically either way; the difference is only in
 * what the record claims about them.
 */
const UNVERIFIED_LEVEL: EvidenceLevel = "unclear";

/**
 * The evidence came back in a shape no amount of conservatism can rescue — a
 * different number of findings, or findings for dimensions that are not in the
 * rubric. Both mean we cannot tell which finding belongs to which dimension, so
 * there is nothing safe to salvage and the run is rejected outright.
 */
export class TranscriptEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptEvidenceValidationError";
  }
}

export interface ValidatedDimensionEvidence {
  dimension_id: string;
  /** The level after validation — never higher than what survived verification. */
  evidence_level: EvidenceLevel;
  /** What the model claimed, kept so a downgrade is visible in the audit trail. */
  reported_evidence_level: EvidenceLevel;
  /** Only items whose quote was found in the candidate's own speech. */
  evidence_items: EvidenceItem[];
  notes: string | null;
}

export interface ValidatedTranscriptEvidence {
  dimensions: ValidatedDimensionEvidence[];
  extraction_summary: string;
  /**
   * Soft findings: quotes that did not check out, levels that were downgraded,
   * evidence attached to a "nothing found" verdict. Kept separate from the hard
   * errors above because they describe a result we still trust *after*
   * correcting it, and a recruiter reading the score deserves to see both the
   * correction and why it happened.
   */
  warnings: string[];
}

/**
 * Check the model's evidence against the transcript and correct it downwards
 * where it does not hold up.
 *
 * Two kinds of failure, handled differently on purpose:
 *
 * - **Structural** (wrong count, unknown or duplicated dimension id) — the
 *   mapping between findings and rubric dimensions is broken, so nothing can be
 *   trusted and the run is thrown away.
 * - **Evidential** (a quote that is not in the candidate's speech) — the
 *   mapping is intact and only this claim failed, so the claim is dropped and
 *   the level is downgraded, with a warning recorded.
 *
 * Nothing here can ever raise a level. A model that wants a higher score has to
 * find words the candidate actually said.
 */
export function validateTranscriptEvidence(params: {
  response: EvidenceResponse;
  /** Rubric dimension ids, in rubric order. */
  dimensionIds: string[];
  /** The candidate's own words — see `buildCandidateSpeech`. */
  candidateSpeech: string;
}): ValidatedTranscriptEvidence {
  const { response, dimensionIds, candidateSpeech } = params;
  const warnings: string[] = [];

  if (response.dimensions.length !== dimensionIds.length) {
    throw new TranscriptEvidenceValidationError(
      `Expected evidence for ${dimensionIds.length} dimension(s) but received ${response.dimensions.length}.`,
    );
  }

  const byId = new Map<string, DimensionEvidence>();
  for (const reported of response.dimensions) {
    if (byId.has(reported.dimension_id)) {
      throw new TranscriptEvidenceValidationError(
        `Evidence for dimension ${reported.dimension_id} was returned more than once.`,
      );
    }
    byId.set(reported.dimension_id, reported);
  }

  const dimensions = dimensionIds.map((dimensionId) => {
    const reported = byId.get(dimensionId);
    if (!reported) {
      throw new TranscriptEvidenceValidationError(
        `No evidence was returned for dimension ${dimensionId}.`,
      );
    }
    return validateOne(reported, candidateSpeech, warnings);
  });

  return { dimensions, extraction_summary: response.extraction_summary, warnings };
}

function validateOne(
  reported: DimensionEvidence,
  candidateSpeech: string,
  warnings: string[],
): ValidatedDimensionEvidence {
  const id = reported.dimension_id;

  if (reported.evidence_level === "not_present") {
    // A "nothing found" verdict that ships quotes is self-contradictory. The
    // verdict is the conservative half, so it wins and the items go.
    if (reported.evidence_items.length > 0) {
      warnings.push(
        `${id}: evidence level "not_present" was returned with ${reported.evidence_items.length} evidence item(s); the items were discarded.`,
      );
    }
    return {
      dimension_id: id,
      evidence_level: "not_present",
      reported_evidence_level: "not_present",
      evidence_items: [],
      notes: reported.notes,
    };
  }

  const verified: EvidenceItem[] = [];
  for (const item of reported.evidence_items) {
    if (normalizedIncludes(candidateSpeech, item.quote)) {
      verified.push(item);
    } else {
      warnings.push(
        `${id}: a quote could not be found in the candidate's speech and was discarded — "${item.quote.trim()}".`,
      );
    }
  }

  if (verified.length === 0) {
    warnings.push(
      reported.evidence_items.length === 0
        ? `${id}: evidence level "${reported.evidence_level}" was returned with no supporting quote; downgraded to "${UNVERIFIED_LEVEL}".`
        : `${id}: no quote for "${reported.evidence_level}" could be verified; downgraded to "${UNVERIFIED_LEVEL}".`,
    );
    return {
      dimension_id: id,
      evidence_level: UNVERIFIED_LEVEL,
      reported_evidence_level: reported.evidence_level,
      evidence_items: [],
      notes: reported.notes,
    };
  }

  return {
    dimension_id: id,
    evidence_level: reported.evidence_level,
    reported_evidence_level: reported.evidence_level,
    evidence_items: verified,
    notes: reported.notes,
  };
}
