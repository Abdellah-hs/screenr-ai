import { EvidenceLevelSchema, type EvidenceLevel } from "@/lib/scoring/evidence-levels";
import {
  EvidenceItemSchema,
  DimensionEvidenceSchema,
  EvidenceResponseSchema,
  type EvidenceItem,
  type DimensionEvidence,
  type EvidenceResponse,
} from "@/lib/scoring/transcript-evidence";

export { EvidenceLevelSchema, type EvidenceLevel };

/**
 * The reporting shape moved to `@/lib/scoring/transcript-evidence` on
 * 2026-08-28, when the AI interview came onto the same pipeline. Both stages
 * grade speech against a weighted rubric, so what a model is allowed to say has
 * exactly one definition; only what each level MEANS is stage-specific, and
 * that is what stays in this file.
 */
export const ScreeningEvidenceItemSchema = EvidenceItemSchema;
export const ScreeningDimensionEvidenceSchema = DimensionEvidenceSchema;
export const ScreeningEvidenceResponseSchema = EvidenceResponseSchema;

export type ScreeningEvidenceItem = EvidenceItem;
export type ScreeningDimensionEvidence = DimensionEvidence;
export type ScreeningEvidenceResponse = EvidenceResponse;

export { UNANSWERED_LEVEL } from "@/lib/scoring/transcript-evidence";

/**
 * What each level means for a *spoken* competency, as handed to the model.
 *
 * The ladder is shared with resume screening and the AI interview; these
 * definitions are not, and must not be. A CV proves a skill by listing a role
 * and a duration; speech proves it by what the candidate can actually say about
 * the work when asked. Reusing the resume wording here would quietly grade
 * speech as though it were a document — penalising a candidate for not reciting
 * dates and job titles out loud.
 *
 * They are also deliberately not shared with the INTERVIEW definitions, which
 * are calibrated for a long technical conversation rather than a short filter.
 * See `INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS`.
 *
 * Worded for a competency rather than a question since evidence is reported per
 * rubric dimension: what matters is whether the call established the skill at
 * all, not whether it was established in the turn that asked about it.
 *
 * Kept next to the enum so the prompt and the type can never drift apart, and
 * exported because the audit log records which wording produced a run.
 */
export const SCREENING_EVIDENCE_LEVEL_DEFINITIONS: Record<EvidenceLevel, string> = {
  not_present:
    "Nothing anywhere in the call bears on this. The topic never came up, the call ended before reaching it, or the candidate explicitly declined.",
  unclear:
    "The candidate said something touching this, but it does not establish the skill — a deflection, a restatement of the question, or a reply too vague to tell whether they have the experience.",
  weak:
    "The candidate claims this but supplies nothing behind it: naming a tool, a topic, or a job title without any account of what they actually did.",
  partial:
    "There is concrete but limited evidence — one example, briefly described, or a description of what they know rather than what they did with it.",
  strong:
    "Clear, specific evidence grounded in the candidate's own work: what the situation was, what they did about it, and what came of it.",
  very_strong:
    "Several substantial examples, or one covered with real depth — trade-offs weighed, decisions justified, outcomes and their limits described unprompted.",
};
