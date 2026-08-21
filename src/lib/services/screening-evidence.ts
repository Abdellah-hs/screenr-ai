import OpenAI from "openai";
import {
  buildCandidateSpeech,
  buildTranscriptDocument,
  hasCandidateSpeech,
  SCREENING_EVIDENCE_LEVEL_DEFINITIONS,
  ScreeningEvidenceResponseSchema,
  type ScreeningEvidenceResponse,
  type TranscriptTurn,
} from "@/lib/screening-scoring";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const SCREENING_EVIDENCE_MODEL = "gpt-4o-mini";

/**
 * v3: the model no longer returns numbers. It reports an evidence level and
 * verbatim quotes per question; `src/lib/screening-scoring/` derives every
 * score. Bumped from the v2 numeric voice prompt it replaces.
 */
export const SCREENING_EVIDENCE_PROMPT_VERSION = "v3_screening_evidence";

export interface TranscriptEvidenceResult {
  evidence: ScreeningEvidenceResponse;
  rawOutput: string;
  model: string;
  promptVersion: string;
  /** True when the model was never called because nobody spoke. */
  skipped: boolean;
}

/**
 * Read a voice-screening transcript and report, per question, how much evidence
 * the candidate actually gave — never a score.
 *
 * The candidate answers a question whenever it comes up in conversation, not in
 * neat per-question slots, so the model is asked to locate each question's
 * evidence across the whole transcript and quote the candidate verbatim
 * (PRD 3.4.3: a score must trace back to the transcript). Those quotes are
 * checked against the candidate's own speech by `validateScreeningEvidence`
 * before any of it counts.
 *
 * This replaced a prompt that asked for a 0-100 score per question. The reason
 * is the same one that took numbers off the resume stage: "is this a 68 or a
 * 74" has no stable answer, so the same call could score differently on
 * consecutive runs, whereas a reading of what the candidate said repeats.
 */
export async function extractTranscriptEvidence(params: {
  jobDescription: string;
  questions: { id: string; prompt: string }[];
  transcript: TranscriptTurn[];
}): Promise<TranscriptEvidenceResult> {
  const { jobDescription, questions, transcript } = params;

  // Never feed the model a transcript with no candidate turns — it fills the
  // silence by inventing answers. This is the authoritative backstop for every
  // scoring path (recruiter re-score AND the auto-score on completion).
  if (!hasCandidateSpeech(transcript)) {
    return noCandidateSpeechEvidence(questions);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const questionList = questions
    .map((q) => `- [${q.id}] ${q.prompt}`)
    .join("\n");

  const levelDefinitions = Object.entries(SCREENING_EVIDENCE_LEVEL_DEFINITIONS)
    .map(([level, definition]) => `- "${level}": ${definition}`)
    .join("\n");

  // The exact string the model reads. Quotes are verified against the candidate
  // half of this same rendering, so prompt and verification corpus cannot drift.
  const conversation = buildTranscriptDocument(transcript);

  const response = await openai.chat.completions.create({
    model: SCREENING_EVIDENCE_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert ATS evaluator reading the transcript of a spoken screening interview. The interviewer asked a fixed set of questions (with unscripted follow-ups); the candidate answered conversationally.

Your job is to REPORT EVIDENCE, not to score. You never assign numbers, ratings, percentages, rankings, or hire/no-hire opinions. For each listed question, find the candidate's relevant spoken evidence anywhere in the transcript and classify how much of it there is, using exactly these levels:

${levelDefinitions}

Quoting rules (critical — a quote that fails these is discarded and the question is downgraded):
- Every level above "not_present" MUST be supported by at least one quote copied VERBATIM from the transcript.
- Quote the Candidate ONLY. Never quote the Interviewer. The interviewer states the topic of every question, so quoting them proves nothing about the candidate.
- Copy the words exactly as they appear. Do not paraphrase, correct, tidy, or join separated phrases with an ellipsis.
- If the candidate never substantively addressed a question, use "not_present" and return an empty evidence_items array.

Judging the evidence:
- Do NOT award a higher level for general enthusiasm, stated interest, or merely naming a relevant topic. A level above "weak" requires the candidate describing work they actually did.
- Judge only what the candidate said. Do not infer experience from their job title, from the question being asked, or from what a person in their role would probably know.

Return JSON in this exact format:
{
  "answers": [
    {
      "question_id": "string",
      "evidence_level": "not_present" | "unclear" | "weak" | "partial" | "strong" | "very_strong",
      "evidence_items": [
        { "quote": "verbatim candidate words", "turn_index": number, "explanation": "1 sentence on what this shows" }
      ],
      "notes": "1-2 sentences on what the candidate did or did not establish, or null"
    }
  ],
  "extraction_summary": "2-3 sentence summary of what the candidate covered across the call"
}

Rules:
- answers must have exactly one entry per listed question, in the same order
- question_id must match the listed id verbatim
- turn_index is the 0-based position of the transcript line the quote came from`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}

## Screening Questions
${questionList}

## Interview Transcript
${conversation}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for transcript evidence extraction");
  }

  return {
    evidence: ScreeningEvidenceResponseSchema.parse(JSON.parse(content)),
    rawOutput: content,
    model: SCREENING_EVIDENCE_MODEL,
    promptVersion: SCREENING_EVIDENCE_PROMPT_VERSION,
    skipped: false,
  };
}

/**
 * The evidence for a call nobody spoke in: every question `not_present`.
 *
 * Built in code rather than asked for, so a silent call cannot be talked out of
 * by a model that would rather find something.
 */
function noCandidateSpeechEvidence(questions: { id: string }[]): TranscriptEvidenceResult {
  return {
    evidence: {
      answers: questions.map((q) => ({
        question_id: q.id,
        evidence_level: "not_present" as const,
        evidence_items: [],
        notes: "No spoken response was captured for this question.",
      })),
      extraction_summary:
        "No spoken response was captured in this call — the candidate did not answer any questions.",
    },
    rawOutput: JSON.stringify({ skipped: "no_candidate_speech" }),
    model: SCREENING_EVIDENCE_MODEL,
    promptVersion: SCREENING_EVIDENCE_PROMPT_VERSION,
    skipped: true,
  };
}

/** Re-exported so callers building the verification corpus use the same one. */
export { buildCandidateSpeech };
