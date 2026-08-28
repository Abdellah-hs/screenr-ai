import OpenAI from "openai";
import type { ScreeningDimension } from "@/lib/screening-scoring";
import { assertApiKeyConfigured } from "@/lib/services/openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GeneratedScreeningQuestion {
  prompt: string;
}

/** Questions drafted when there is no rubric to size the set against. */
export const DEFAULT_SCREENING_QUESTION_COUNT = 5;
export const MIN_DRAFTED_SCREENING_QUESTIONS = 3;
export const MAX_DRAFTED_SCREENING_QUESTIONS = 8;

/**
 * How many questions to draft for a rubric of this size.
 *
 * One question per dimension is the target, because the rubric is the scoring
 * unit: a dimension no question goes looking for scores 0 for every candidate.
 * A fixed count could not hold that — five questions against seven dimensions
 * left two unprobed, and against three dimensions it spent two questions on
 * topics nothing grades.
 *
 * Bounded at both ends, and both bounds are deliberate:
 *
 * - **Floor of 3.** Evidence is extracted across the WHOLE transcript per
 *   dimension, so extra questions give each dimension more chances to be
 *   evidenced. A two-question call puts half the score on each answer, where
 *   one fumbled opening halves the result.
 * - **Ceiling of 8.** Past that a spoken call is long enough that candidates
 *   abandon it, and the prompt already knows how to combine related dimensions
 *   when there are more of them than questions. A saved set is capped at 15 by
 *   `screeningQuestionsArraySchema` regardless.
 *
 * The recruiter can still add or delete questions afterwards — this sizes the
 * draft, it does not constrain the set.
 */
export function screeningQuestionCountForRubric(dimensionCount: number): number {
  if (dimensionCount <= 0) return DEFAULT_SCREENING_QUESTION_COUNT;
  return Math.min(
    MAX_DRAFTED_SCREENING_QUESTIONS,
    Math.max(MIN_DRAFTED_SCREENING_QUESTIONS, dimensionCount),
  );
}

/**
 * Draft the questions the voice screening will ask, from the screening rubric.
 *
 * The rubric is the input because the rubric is what the answers are scored
 * against: every dimension gets evidence extracted for it, so a dimension no
 * question goes looking for scores 0 by default. Questions drafted from the job
 * description alone had no such guarantee — they could probe five things the
 * rubric never mentions while leaving a weighted dimension untouched.
 *
 * Until 2026-08-22 this took the **resume** criteria, which was the wrong
 * rubric for this stage: it drafted questions against what the CV was gated on
 * rather than what the call would be graded on.
 *
 * Advisory, like every other generator here — the recruiter edits and saves.
 */
export async function generateQuestionsForRole(params: {
  jobDescription: string;
  /** The screening rubric. Empty falls back to the description alone. */
  rubricDimensions: Pick<ScreeningDimension, "name">[];
  /** Override the rubric-derived count. Callers normally omit this. */
  count?: number;
}): Promise<GeneratedScreeningQuestion[]> {
  assertApiKeyConfigured();

  const { jobDescription, rubricDimensions } = params;
  const count = params.count ?? screeningQuestionCountForRubric(rubricDimensions.length);

  const dimensionList = rubricDimensions.map((d) => `- ${d.name}`).join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert HR hiring consultant. Generate targeted, open-ended questions for a SPOKEN screening call with a candidate who passed initial resume screening. The goal is to surface evidence the resume cannot — concrete examples, decisions made, and depth on the competencies the recruiter will grade.

You are given the EVALUATION RUBRIC for this screening. The candidate's answers will be scored by extracting evidence for each rubric dimension, so a dimension no question goes looking for will score zero.

Return JSON in this exact format:
{
  "questions": [
    { "prompt": "string" }
  ]
}

Rules:
- Produce exactly ${count} questions
- Every rubric dimension must be probed by at least one question. If there are more dimensions than questions, combine the closest-related ones rather than dropping any.
- If there are more questions than dimensions, spend the extra ones probing the same dimensions from a different angle. Do not introduce a topic the rubric does not name — nothing scores it.
- Each prompt is a single clear question (no multi-part stacked questions)
- Each prompt is 1-2 sentences, phrased in second person ("Tell us about...", "Describe a time when...")
- Written to be ASKED ALOUD and answered in speech: plain wording, nothing that needs re-reading, no lists to enumerate
- Avoid yes/no questions — every question must invite a narrative answer
- Do not ask for information already on a typical resume (work history, job titles, dates)`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}

## Evaluation Rubric — the answers will be scored on these
${dimensionList || "(no rubric yet — use the job description to infer what to probe)"}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for screening question generation");
  }

  const parsed = JSON.parse(content) as {
    questions?: { prompt: string }[];
  };

  if (!parsed.questions?.length) {
    throw new Error("OpenAI returned no screening questions");
  }

  return parsed.questions.map((q) => ({
    prompt: String(q.prompt).trim(),
  }));
}

export interface ScoredAnswer {
  question_id: string;
  score: number;
  rationale: string;
  /**
   * The candidate's own words behind this score, and the transcript turn they
   * came from (PRD 3.4.4). Voice scoring only — a typed answer is already the
   * evidence, and the text path was retired in #161 anyway.
   *
   * Optional because responses scored before #148 have neither: the quote was
   * parsed, used to verify the score, and then discarded.
   */
  evidence_quote?: string;
  evidence_turn_index?: number | null;
}

export interface AnswerScoringResult {
  overall_score: number;
  overall_rationale: string;
  answers: ScoredAnswer[];
}

export const SCREENING_SCORING_MODEL = "gpt-4o-mini";
// v2: unanswered questions must score exactly 0 (no "general interest" partial
// credit). This is the LEGACY TEXT path only — the typed-answer form was
// retired in #161. The live voice path asks for evidence levels instead of
// numbers and lives in `services/screening-evidence.ts`.
export const SCREENING_SCORING_PROMPT_VERSION = "v2_screening_scoring";

export interface AnswerScoringEvidence {
  result: AnswerScoringResult;
  rawOutput: string;
  model: string;
  promptVersion: string;
}

/**
 * AI-scores a candidate's screening answers.
 *
 * Returns both the normalized result AND the raw output + model identifiers
 * so the caller can persist an `ai_audit_log` row per the "Mandatory AI
 * Output Persistence" rule in CLAUDE.md.
 */
export async function scoreAnswers(params: {
  jobDescription: string;
  questions: { id: string; prompt: string }[];
  answers: { question_id: string; answer_text: string }[];
}): Promise<AnswerScoringEvidence> {
  assertApiKeyConfigured();

  const { jobDescription, questions, answers } = params;

  const qaPairs = questions
    .map((q) => {
      const match = answers.find((a) => a.question_id === q.id);
      const answerText = match?.answer_text?.trim() || "(no answer provided)";
      return `### Question [${q.id}]
${q.prompt}

Answer:
${answerText}`;
    })
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: SCREENING_SCORING_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert ATS evaluator scoring written screening answers. Score each answer 0-100 based on:
- Relevance and specificity (did the candidate answer the question?)
- Concrete evidence (examples, metrics, outcomes)
- Depth of reasoning
- Alignment with the role

Scoring a non-answer (critical):
- An unanswered question ("(no answer provided)"), a blank answer, or a non-answer such as "I don't know" / "n/a" / a few unrelated words is NOT an answer. Score it exactly 0.
- Do NOT award any credit for general enthusiasm, stated interest, or merely naming a relevant topic. Points require the candidate actually answering THAT question with relevant substance.
- Every score above 0 must be justified by specific content the candidate actually wrote.

Then compute an overall_score as the simple average of per-answer scores (0-100, rounded).

Return JSON in this exact format:
{
  "overall_score": number,
  "overall_rationale": "2-3 sentence summary of the candidate's screening answers",
  "answers": [
    { "question_id": "string", "score": number, "rationale": "1-2 sentence per-answer justification" }
  ]
}

Rules:
- answers array must have exactly one entry per input question, in the same order
- question_id must match the input id verbatim
- overall_rationale references specific answers, not generic fluff`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}

## Candidate Answers
${qaPairs}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for answer scoring");
  }

  // Deterministic backstop (Control > AI > Data): we know the exact answer text
  // here, so we enforce "no answer = 0" in code rather than trusting the model
  // to honor it — it has been observed handing out partial credit for blanks.
  const unansweredIds = new Set(
    questions
      .filter((q) => {
        const match = answers.find((a) => a.question_id === q.id);
        return !match?.answer_text?.trim();
      })
      .map((q) => q.id),
  );

  return {
    result: zeroOutUnanswered(normalizeScoringResult(content), unansweredIds),
    rawOutput: content,
    model: SCREENING_SCORING_MODEL,
    promptVersion: SCREENING_SCORING_PROMPT_VERSION,
  };
}

/** Recompute overall_score as the rounded average of the per-question scores. */
function averageOverall(answers: ScoredAnswer[]): number {
  if (answers.length === 0) return 0;
  return Math.round(answers.reduce((sum, a) => sum + a.score, 0) / answers.length);
}

/**
 * Force a 0 for every question that received no answer, then recompute the
 * overall so it can never exceed what the answered questions support. A no-op
 * when nothing was left blank (preserves the model's own overall).
 */
function zeroOutUnanswered(
  result: AnswerScoringResult,
  unansweredIds: Set<string>,
): AnswerScoringResult {
  if (unansweredIds.size === 0) return result;

  let changed = false;
  const answers = result.answers.map((a) => {
    if (unansweredIds.has(a.question_id) && a.score !== 0) {
      changed = true;
      return {
        ...a,
        score: 0,
        rationale: "Scored 0: no answer was provided for this question.",
      };
    }
    return a;
  });

  if (!changed) return result;
  return { ...result, answers, overall_score: averageOverall(answers) };
}

/** Clamp/round the model's JSON into a normalized, 0..100 result. Shared by the
 * text-answer and voice-transcript scorers so both persist identical evidence. */
function normalizeScoringResult(content: string): AnswerScoringResult {
  const parsed = JSON.parse(content) as AnswerScoringResult;

  return {
    overall_score: Math.max(0, Math.min(100, Math.round(parsed.overall_score))),
    overall_rationale: parsed.overall_rationale || "No rationale provided.",
    answers: (parsed.answers || []).map((a) => ({
      question_id: String(a.question_id),
      score: Math.max(0, Math.min(100, Math.round(a.score))),
      rationale: String(a.rationale || ""),
    })),
  };
}
