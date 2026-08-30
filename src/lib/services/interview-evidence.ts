import OpenAI from "openai";
import { assertApiKeyConfigured } from "@/lib/services/openai";
import {
  buildCandidateSpeech,
  buildTranscriptDocument,
  hasCandidateSpeech,
  type TranscriptTurn,
} from "@/lib/scoring/transcript";
import {
  EvidenceResponseSchema,
  UNANSWERED_LEVEL,
  type EvidenceResponse,
} from "@/lib/scoring/transcript-evidence";
import {
  INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS,
  type InterviewRubricDimension,
} from "@/lib/interview-scoring";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const INTERVIEW_EVIDENCE_MODEL = "gpt-4o-mini";

/**
 * v3 tightens what "not_present" may mean. Once an unreached dimension is left
 * OUT of the score rather than scored 0, "not_present" stops being the maximum
 * penalty and becomes better for the candidate than "weak" — so the prompt has
 * to be explicit that it describes the conversation, never the quality of an
 * answer.
 *
 * v2: evidence per **rubric dimension**, no numbers.
 *
 * v1 (`v1_interview_scoring`) asked the model for a 0-100 score per competency
 * AND let it choose the competencies. It is the version stamped on every
 * interview scored before 2026-08-28, so the bump is what lets a stored score
 * say which mechanism produced it.
 */
export const INTERVIEW_EVIDENCE_PROMPT_VERSION = "v3_rubric_dimension_evidence";

export interface InterviewEvidenceResult {
  evidence: EvidenceResponse;
  rawOutput: string;
  model: string;
  promptVersion: string;
  /** True when the model was never called because nobody spoke. */
  skipped: boolean;
}

/**
 * Read an AI-interview transcript and report, per **rubric dimension**, how
 * much evidence the candidate actually gave — never a score.
 *
 * This replaced `scoreInterview`, which asked the model to "score each 0-100".
 * Two separate problems went with it:
 *
 * 1. **The numbers were not reproducible.** "Is this a 68 or a 74" has no
 *    stable answer, so the same interview could score differently on
 *    consecutive runs. A reading of what the candidate said repeats.
 * 2. **The recruiter's rubric was never read.** The old prompt told the model to
 *    "identify the competencies the role actually calls for", and the one
 *    caller never passed the campaign's interview rubric at all — so a rubric
 *    the recruiter had built, weighted and maintained decided nothing. The
 *    dimensions are now given, and every one of them is reported on.
 *
 * The unit is the dimension, not the question. A candidate who proves a
 * competency while answering some other question has proved it, and reading per
 * question grades the eliciting turn rather than the competency.
 *
 * Quotes come back verbatim (PRD 3.10.2: a score must trace back to the
 * transcript) and are checked against the candidate's own speech by
 * `validateTranscriptEvidence` before any of it counts.
 */
export async function extractInterviewEvidence(params: {
  jobDescription: string;
  resumeSummary?: string | null;
  /** The rubric, in rubric order. Evidence comes back index-aligned to this. */
  dimensions: InterviewRubricDimension[];
  transcript: TranscriptTurn[];
}): Promise<InterviewEvidenceResult> {
  const { jobDescription, resumeSummary, dimensions, transcript } = params;

  // Never feed the model a transcript with no candidate turns — it fills the
  // silence by inventing answers. This is the authoritative backstop for every
  // scoring path (recruiter re-score AND the auto-score on completion).
  if (!hasCandidateSpeech(transcript)) {
    return noCandidateSpeechEvidence(dimensions);
  }

  assertApiKeyConfigured();

  const dimensionList = dimensions.map((d) => `- [${d.id}] ${d.name}`).join("\n");

  const levelDefinitions = Object.entries(INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS)
    .map(([level, definition]) => `- "${level}": ${definition}`)
    .join("\n");

  // The exact string the model reads. Quotes are verified against the candidate
  // half of this same rendering, so prompt and verification corpus cannot drift.
  const conversation = buildTranscriptDocument(transcript);

  const response = await openai.chat.completions.create({
    model: INTERVIEW_EVIDENCE_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert technical interviewer reading the transcript of a live AI-led interview. The interviewer asked questions with follow-ups; the candidate answered conversationally.

You are given the recruiter's EVALUATION RUBRIC — the competencies this role is judged on. Your job is to REPORT EVIDENCE against each rubric dimension, not to score. You never assign numbers, ratings, percentages, rankings, or hire/no-hire opinions. For each listed dimension, find the candidate's relevant evidence ANYWHERE in the transcript and classify how much of it there is, using exactly these levels:

${levelDefinitions}

This is a full interview, not a short screening call. The bar is correspondingly higher: a single example described at surface level is "partial", and "strong" requires the candidate's REASONING to be visible — the constraints, the options weighed, why they chose what they chose.

Where to look (important):
- Evidence for a dimension may appear in ANY answer, not only in the answer to the question that sounds closest to it. A candidate often evidences one competency while talking about something else. Read the whole interview for each dimension.
- The same stretch of speech may legitimately evidence more than one dimension. Judge each dimension on its own merits.
- Follow-up exchanges are often the most informative part: an answer that holds up under a probe is stronger evidence than the original claim.

Quoting rules (critical — a quote that fails these is discarded and the dimension is downgraded):
- Every level above "not_present" MUST be supported by at least one quote copied VERBATIM from the transcript.
- Quote the Candidate ONLY. Never quote the Interviewer. The interviewer states the topic of every question, so quoting them proves nothing about the candidate.
- Copy the words exactly as they appear. Do not paraphrase, correct, tidy, or join separated phrases with an ellipsis.
- If nothing in the interview bears on a dimension, use "not_present" and return an empty evidence_items array.

"not_present" vs a poor answer (read this carefully — the two are not interchangeable):
- "not_present" means the CONVERSATION NEVER WENT NEAR the topic. It is a statement about the interview, not about the candidate, and a dimension marked this way is left out of the score entirely rather than scored low.
- A candidate who WAS asked about something and answered badly, vaguely, or said they did not know is NOT "not_present". That is "unclear" or "weak" — they were given the chance and what they said established little.
- So never reach for "not_present" because an answer was poor. Use it only when you cannot point to any part of the interview where the subject came up at all.

Judging the evidence:
- Do NOT award a higher level for general enthusiasm, stated interest, confidence, or merely naming a relevant technology. A level above "weak" requires the candidate describing work they actually did.
- Judge only what the candidate said. Do not infer competence from their job title, from their CV, from a question having been asked, or from what a person in their role would probably know.
- A candidate who says they do not know something has not evidenced the competency. That is an "unclear" reading — they were asked and could not answer — never "not_present", and never a reason to mark down a different dimension.

Return JSON in this exact format:
{
  "dimensions": [
    {
      "dimension_id": "string",
      "evidence_level": "not_present" | "unclear" | "weak" | "partial" | "strong" | "very_strong",
      "evidence_items": [
        { "quote": "verbatim candidate words", "turn_index": number, "explanation": "1 sentence on what this shows" }
      ],
      "notes": "1-2 sentences on what the candidate did or did not establish for this competency, or null"
    }
  ],
  "extraction_summary": "2-3 sentence summary of what the candidate demonstrated across the interview"
}

Rules:
- dimensions must have exactly one entry per listed rubric dimension, in the same order
- dimension_id must match the listed id verbatim
- turn_index is the 0-based position of the transcript line the quote came from`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}
${resumeSummary ? `\n## Candidate Background (context only — never evidence)\n${resumeSummary}` : ""}

## Evaluation Rubric — report evidence for each of these
${dimensionList}

## Interview Transcript
${conversation}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for interview evidence extraction");
  }

  return {
    evidence: EvidenceResponseSchema.parse(JSON.parse(content)),
    rawOutput: content,
    model: INTERVIEW_EVIDENCE_MODEL,
    promptVersion: INTERVIEW_EVIDENCE_PROMPT_VERSION,
    skipped: false,
  };
}

/**
 * The evidence for an interview nobody spoke in: every dimension
 * `not_present`.
 *
 * Built in code rather than asked for, so a silent interview cannot be talked
 * out of by a model that would rather find something.
 */
function noCandidateSpeechEvidence(
  dimensions: { id: string }[],
): InterviewEvidenceResult {
  return {
    evidence: {
      dimensions: dimensions.map((d) => ({
        dimension_id: d.id,
        evidence_level: UNANSWERED_LEVEL,
        evidence_items: [],
        notes: "No spoken response was captured in this interview.",
      })),
      extraction_summary:
        "No spoken response was captured in this interview — the candidate did not answer any questions.",
    },
    rawOutput: JSON.stringify({ skipped: "no_candidate_speech" }),
    model: INTERVIEW_EVIDENCE_MODEL,
    promptVersion: INTERVIEW_EVIDENCE_PROMPT_VERSION,
    skipped: true,
  };
}

/** Re-exported so callers building the verification corpus use the same one. */
export { buildCandidateSpeech };
