import OpenAI from "openai";
import { assertApiKeyConfigured } from "@/lib/services/openai";
import {
  buildCandidateSpeech,
  buildTranscriptDocument,
  hasCandidateSpeech,
  SCREENING_EVIDENCE_LEVEL_DEFINITIONS,
  ScreeningEvidenceResponseSchema,
  UNANSWERED_LEVEL,
  type ScreeningDimension,
  type ScreeningEvidenceResponse,
  type TranscriptTurn,
} from "@/lib/screening-scoring";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const SCREENING_EVIDENCE_MODEL = "gpt-4o-mini";

/**
 * v4: evidence is reported per **rubric dimension** rather than per question.
 * The questions still go into the prompt, but as context for reading the call —
 * they are how the interviewer went looking, not what is being graded.
 *
 * v3 (per question) is the version stamped on every score taken before this, so
 * the bump is what lets a stored score say which unit produced it.
 */
export const SCREENING_EVIDENCE_PROMPT_VERSION = "v4_rubric_dimension_evidence";

export interface TranscriptEvidenceResult {
  evidence: ScreeningEvidenceResponse;
  rawOutput: string;
  model: string;
  promptVersion: string;
  /** True when the model was never called because nobody spoke. */
  skipped: boolean;
}

/**
 * Read a voice-screening transcript and report, per **rubric dimension**, how
 * much evidence the candidate actually gave — never a score.
 *
 * The unit is the dimension, not the question, and that is the point. The
 * rubric is what the recruiter decided the role needs; the questions are only
 * how the call went looking for it. A candidate who proves a competency while
 * answering some other question has proved it, and per-question reading could
 * not see that — it graded the eliciting turn, and gave a competency that
 * happened to be probed twice double the say of one probed once.
 *
 * The questions are still supplied, as context for reading the conversation.
 * They tell the model what was asked and in what terms, which is how it locates
 * the relevant stretch of talk; they are not what it reports on.
 *
 * Quotes come back verbatim (PRD 3.4.3: a score must trace back to the
 * transcript) and are checked against the candidate's own speech by
 * `validateScreeningEvidence` before any of it counts.
 *
 * This descends from a prompt that asked for a 0-100 score per question. The
 * reason numbers left is the same one that took them off the resume stage: "is
 * this a 68 or a 74" has no stable answer, so the same call could score
 * differently on consecutive runs, whereas a reading of what the candidate said
 * repeats.
 */
export async function extractTranscriptEvidence(params: {
  jobDescription: string;
  /** The rubric, in rubric order. Evidence comes back index-aligned to this. */
  dimensions: ScreeningDimension[];
  /** What the interviewer asked — context for reading the call, not the unit. */
  questions: { id: string; prompt: string }[];
  transcript: TranscriptTurn[];
}): Promise<TranscriptEvidenceResult> {
  const { jobDescription, dimensions, questions, transcript } = params;

  // Never feed the model a transcript with no candidate turns — it fills the
  // silence by inventing answers. This is the authoritative backstop for every
  // scoring path (recruiter re-score AND the auto-score on completion).
  if (!hasCandidateSpeech(transcript)) {
    return noCandidateSpeechEvidence(dimensions);
  }

  assertApiKeyConfigured();

  const dimensionList = dimensions
    .map((d) => `- [${d.id}] ${d.name}`)
    .join("\n");

  const questionList = questions
    .map((q) => `- ${q.prompt}`)
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
        content: `You are an expert ATS evaluator reading the transcript of a spoken screening interview. The interviewer asked a set of questions (with unscripted follow-ups); the candidate answered conversationally.

You are given the recruiter's EVALUATION RUBRIC — the competencies this role is judged on. Your job is to REPORT EVIDENCE against each rubric dimension, not to score. You never assign numbers, ratings, percentages, rankings, or hire/no-hire opinions. For each listed dimension, find the candidate's relevant spoken evidence ANYWHERE in the transcript and classify how much of it there is, using exactly these levels:

${levelDefinitions}

Where to look (important):
- Evidence for a dimension may appear in ANY answer, not only in the answer to the question that sounds closest to it. A candidate often evidences one competency while talking about something else. Read the whole call for each dimension.
- The same stretch of speech may legitimately evidence more than one dimension. Judge each dimension on its own merits.
- The questions are given only as context for what was asked. Do NOT report on the questions, and do not treat a dimension as covered merely because a question touching it was asked.

Quoting rules (critical — a quote that fails these is discarded and the dimension is downgraded):
- Every level above "not_present" MUST be supported by at least one quote copied VERBATIM from the transcript.
- Quote the Candidate ONLY. Never quote the Interviewer. The interviewer states the topic of every question, so quoting them proves nothing about the candidate.
- Copy the words exactly as they appear. Do not paraphrase, correct, tidy, or join separated phrases with an ellipsis.
- If nothing in the call bears on a dimension, use "not_present" and return an empty evidence_items array.

Judging the evidence:
- Do NOT award a higher level for general enthusiasm, stated interest, or merely naming a relevant topic. A level above "weak" requires the candidate describing work they actually did.
- Judge only what the candidate said. Do not infer experience from their job title, from a question having been asked, or from what a person in their role would probably know.

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
  "extraction_summary": "2-3 sentence summary of what the candidate covered across the call"
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

## Evaluation Rubric — report evidence for each of these
${dimensionList}

## Questions the interviewer asked (context only — do not report on these)
${questionList || "(none recorded)"}

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
 * The evidence for a call nobody spoke in: every dimension `not_present`.
 *
 * Built in code rather than asked for, so a silent call cannot be talked out of
 * by a model that would rather find something.
 */
function noCandidateSpeechEvidence(
  dimensions: { id: string }[],
): TranscriptEvidenceResult {
  return {
    evidence: {
      dimensions: dimensions.map((d) => ({
        dimension_id: d.id,
        evidence_level: UNANSWERED_LEVEL,
        evidence_items: [],
        notes: "No spoken response was captured in this call.",
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
