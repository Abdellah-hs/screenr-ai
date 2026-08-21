import { z } from "zod/v4";
import { EvidenceLevelSchema, type EvidenceLevel } from "@/lib/scoring/evidence-levels";

export { EvidenceLevelSchema, type EvidenceLevel };

/**
 * One spoken turn of a voice-screening call, in conversation order.
 *
 * Declared here rather than imported from the data layer so this package stays
 * pure — `src/lib/data/screening-questions.ts` owns the row shape, and its
 * `VoiceTranscriptTurn` is structurally identical.
 */
export interface TranscriptTurn {
  role: "agent" | "candidate";
  text: string;
  at: string;
}

export const ScreeningEvidenceItemSchema = z.object({
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

export const ScreeningAnswerEvidenceSchema = z.object({
  question_id: z.string(),
  evidence_level: EvidenceLevelSchema,
  evidence_items: z.array(ScreeningEvidenceItemSchema),
  notes: z.string().nullable(),
});

export const ScreeningEvidenceResponseSchema = z.object({
  answers: z.array(ScreeningAnswerEvidenceSchema),
  extraction_summary: z.string(),
});

export type ScreeningEvidenceItem = z.infer<typeof ScreeningEvidenceItemSchema>;
export type ScreeningAnswerEvidence = z.infer<typeof ScreeningAnswerEvidenceSchema>;
export type ScreeningEvidenceResponse = z.infer<typeof ScreeningEvidenceResponseSchema>;

/**
 * What each level means for a *spoken answer*, as handed to the model.
 *
 * The ladder is shared with resume screening; these definitions are not, and
 * must not be. A CV proves a skill by listing a role and a duration; an answer
 * proves it by what the candidate can actually say about the work when asked.
 * Reusing the resume wording here would quietly grade speech as though it were
 * a document — penalising a candidate for not reciting dates and job titles out
 * loud.
 *
 * Kept next to the enum so the prompt and the type can never drift apart, and
 * exported because the audit log records which wording produced a run.
 */
export const SCREENING_EVIDENCE_LEVEL_DEFINITIONS: Record<EvidenceLevel, string> = {
  not_present:
    "The candidate never addressed this question. It was never asked, the call ended before reaching it, or they explicitly declined to answer.",
  unclear:
    "The candidate said something touching the topic, but it does not establish an answer — a deflection, a restatement of the question, or a reply too vague to tell whether they have the experience.",
  weak:
    "The candidate claims the experience but supplies nothing behind it: naming a tool, a topic, or a job title without any account of what they actually did.",
  partial:
    "There is a concrete but limited answer — one example, briefly described, or a description of what they know rather than what they did with it.",
  strong:
    "A clear, specific answer grounded in the candidate's own work: what the situation was, what they did about it, and what came of it.",
  very_strong:
    "Several substantial examples, or one answered with real depth — trade-offs weighed, decisions justified, outcomes and their limits described unprompted.",
};

/**
 * The level a question gets when the candidate never reached it.
 *
 * Distinct from every other path into `not_present`: this one is decided by
 * code, from the transcript itself, and is not the model's to overturn.
 */
export const UNANSWERED_LEVEL: EvidenceLevel = "not_present";
