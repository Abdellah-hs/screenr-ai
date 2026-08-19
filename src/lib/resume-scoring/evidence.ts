import { z } from "zod/v4";

/**
 * How much proof of a criterion the resume actually contains.
 *
 * This is the whole of what the model is allowed to say. It never scores, never
 * weighs, never ranks and never recommends — it reads a document and reports
 * what it found, in a vocabulary with fixed meanings. Every number downstream
 * comes from this label via a lookup table, which is what makes two runs over
 * the same CV produce the same result: the model would have to change its
 * *reading* to change the outcome, not merely its arithmetic.
 */
export const EvidenceLevelSchema = z.enum([
  "not_present",
  "unclear",
  "weak",
  "partial",
  "strong",
  "very_strong",
]);

export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export const EvidenceSourceSectionSchema = z.enum([
  "headline",
  "summary",
  "skills",
  "experience",
  "education",
  "certifications",
  "languages",
  "other",
]);

export type EvidenceSourceSection = z.infer<typeof EvidenceSourceSectionSchema>;

export const ResumeEvidenceItemSchema = z.object({
  /** Copied verbatim from the resume. Verified against the source text later. */
  quote: z.string(),
  source_section: EvidenceSourceSectionSchema,
  explanation: z.string(),
});

export const ResumeCriterionEvidenceSchema = z.object({
  criterion_label: z.string(),
  evidence_level: EvidenceLevelSchema,
  evidence_items: z.array(ResumeEvidenceItemSchema),
  extracted_relevant_months: z.number().int().min(0).nullable(),
  notes: z.string().nullable(),
});

export const ResumeEvidenceResponseSchema = z.object({
  criteria: z.array(ResumeCriterionEvidenceSchema),
  extraction_summary: z.string(),
});

export type ResumeEvidenceItem = z.infer<typeof ResumeEvidenceItemSchema>;
export type ResumeCriterionEvidence = z.infer<typeof ResumeCriterionEvidenceSchema>;
export type ResumeEvidenceResponse = z.infer<typeof ResumeEvidenceResponseSchema>;

/**
 * The same shape without the numeric constraints, used ONLY as the OpenAI
 * structured-outputs schema.
 *
 * The strict-schema subset rejects `minimum` / `maximum` / `multipleOf`, so
 * `.int().min(0)` above cannot be sent over the wire. The response is re-parsed
 * with the canonical schema the moment it arrives, so the constraint is still
 * enforced — just on our side of the boundary rather than the model's.
 */
export const ResumeEvidenceWireSchema = z.object({
  criteria: z.array(
    z.object({
      criterion_label: z.string(),
      evidence_level: EvidenceLevelSchema,
      evidence_items: z.array(ResumeEvidenceItemSchema),
      extracted_relevant_months: z.number().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  extraction_summary: z.string(),
});

/**
 * The definitions handed to the model, kept next to the enum so the prompt and
 * the type can never drift apart. Exported because the extraction prompt embeds
 * them verbatim and the audit log records which wording produced a run.
 */
export const EVIDENCE_LEVEL_DEFINITIONS: Record<EvidenceLevel, string> = {
  not_present: "No explicit evidence for the criterion exists in the resume.",
  unclear:
    "The resume contains ambiguous or indirect wording, but does not clearly establish the criterion.",
  weak:
    "The criterion is mentioned, such as in a skills list, but there is no concrete project, responsibility, duration, or outcome proving use.",
  partial:
    "There is concrete but limited evidence, such as one small project, course, task, or short exposure. The evidence does not establish strong or sustained professional experience.",
  strong:
    "There is clear evidence of meaningful project or professional use, with concrete responsibilities, outcomes, repeated use, or relevant duration.",
  very_strong:
    "There are multiple substantial examples or sustained senior-level, ownership, leadership, architecture, or long-duration evidence.",
};
