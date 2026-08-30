/**
 * Evidence validation for voice screening.
 *
 * The implementation moved to `@/lib/scoring/transcript-evidence` on
 * 2026-08-28, when the AI interview came onto the same pipeline. What a model
 * may claim, and what happens when it cannot back a claim up, must be identical
 * at every stage that grades speech — otherwise a `strong` that survives
 * verification at one stage and not at another makes the shared evidence ladder
 * a fiction.
 *
 * The screening-specific names are kept as aliases so callers and the existing
 * tests are unaffected.
 */
import {
  validateTranscriptEvidence,
  TranscriptEvidenceValidationError,
  type EvidenceResponse,
  type ValidatedTranscriptEvidence,
  type ValidatedDimensionEvidence,
} from "@/lib/scoring/transcript-evidence";

export {
  TranscriptEvidenceValidationError as ScreeningEvidenceValidationError,
  type ValidatedDimensionEvidence,
};

export type ValidatedScreeningEvidence = ValidatedTranscriptEvidence;

export function validateScreeningEvidence(params: {
  response: EvidenceResponse;
  /** Rubric dimension ids, in rubric order. */
  dimensionIds: string[];
  /** The candidate's own words — see `buildCandidateSpeech`. */
  candidateSpeech: string;
}): ValidatedScreeningEvidence {
  return validateTranscriptEvidence(params);
}
