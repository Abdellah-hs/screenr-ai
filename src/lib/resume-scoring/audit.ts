import type { DeterministicResumeScoreResult } from "./deterministic";
import type { ResumeEvidenceResponse } from "./evidence";
import type { CriterionPriority } from "./criteria";

/**
 * Everything needed to reconstruct one scoring run months later, when the
 * campaign has been re-rubriced twice and the model has been upgraded.
 *
 * CLAUDE.md requires the raw output, model and prompt/rubric versions for every
 * AI call. This adds the three things an evidence-based scorer specifically
 * needs to be re-checkable: the hash of the exact document the model read
 * (so "was this the CV we think it was?" is answerable without storing a second
 * copy), the validation warnings raised while checking its quotes, and the
 * deterministic result those inputs produce — which anyone can recompute from
 * `extracted_evidence` and compare.
 *
 * No API key, no credential, ever.
 */
export interface ResumeScoringAudit {
  raw_model_output: string;
  model: string;
  prompt_version: string;
  system_fingerprint: string | null;
  normalized_resume_text_hash: string;
  rubric_version: string | number | null;
  scoring_rules_version: string;
  criteria: { label: string; priority: CriterionPriority }[];
  /** True when the evidence came from the cache rather than a fresh LLM call. */
  cache_hit: boolean;
  extracted_evidence: ResumeEvidenceResponse;
  validation_warnings: string[];
  deterministic_result: DeterministicResumeScoreResult;
  /** Where the resume entered the system ("apply_form", "rescore", …). */
  source: string;
}
