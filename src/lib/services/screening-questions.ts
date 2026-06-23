import OpenAI from "openai";
import type { ScreeningCriterion } from "@/lib/constants";
import type { VoiceTranscriptTurn } from "@/lib/data/screening-questions";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GeneratedScreeningQuestion {
  prompt: string;
  is_required: boolean;
}

export async function generateQuestionsForRole(params: {
  jobDescription: string;
  screeningCriteria: ScreeningCriterion[];
  count?: number;
}): Promise<GeneratedScreeningQuestion[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { jobDescription, screeningCriteria, count = 5 } = params;

  const criteriaList = screeningCriteria
    .map((c) => `- ${c.label} (weight: ${c.weight}, mandatory: ${c.is_mandatory})`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert HR hiring consultant. Generate targeted, open-ended screening questions a recruiter would email to a candidate who passed initial resume screening. The goal is to surface evidence the resume cannot — concrete examples, decision-making, motivation, and depth on the mandatory criteria.

Return JSON in this exact format:
{
  "questions": [
    { "prompt": "string", "is_required": boolean }
  ]
}

Rules:
- Produce exactly ${count} questions
- Each prompt is a single clear question (no multi-part stacked questions)
- Each prompt is 1-2 sentences, phrased in second person ("Tell us about...", "Describe a time when...")
- Avoid yes/no questions — every question must invite a written narrative answer
- Cover the mandatory screening criteria explicitly; touch the high-weight non-mandatory ones when possible
- Mark at least half the questions as required (the ones tied to mandatory criteria)
- Do not ask for information already on a typical resume (work history, job titles, dates)`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}

## Screening Criteria
${criteriaList || "(no explicit criteria — use the job description to infer what to probe)"}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for screening question generation");
  }

  const parsed = JSON.parse(content) as {
    questions?: { prompt: string; is_required: boolean }[];
  };

  if (!parsed.questions?.length) {
    throw new Error("OpenAI returned no screening questions");
  }

  return parsed.questions.map((q) => ({
    prompt: String(q.prompt).trim(),
    is_required: Boolean(q.is_required),
  }));
}

export interface ScoredAnswer {
  question_id: string;
  score: number;
  rationale: string;
}

export interface AnswerScoringResult {
  overall_score: number;
  overall_rationale: string;
  answers: ScoredAnswer[];
}

export const SCREENING_SCORING_MODEL = "gpt-4o-mini";
// v2: unanswered/unaddressed questions must score exactly 0 (no "general
// interest" partial credit), and the voice scorer must ground every non-zero
// score in a verbatim candidate quote that code then verifies.
export const SCREENING_SCORING_PROMPT_VERSION = "v2_screening_scoring";
export const SCREENING_VOICE_SCORING_PROMPT_VERSION = "v2_voice_screening_scoring";

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
  questions: { id: string; prompt: string; is_required: boolean }[];
  answers: { question_id: string; answer_text: string }[];
}): Promise<AnswerScoringEvidence> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { jobDescription, questions, answers } = params;

  const qaPairs = questions
    .map((q) => {
      const match = answers.find((a) => a.question_id === q.id);
      const answerText = match?.answer_text?.trim() || "(no answer provided)";
      return `### Question [${q.id}]${q.is_required ? " (required)" : ""}
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

/**
 * Deterministic zero-score evidence for a voice call in which the candidate
 * never spoke. We do NOT ask the model to score an absence: given a transcript
 * of only the interviewer's questions, gpt-4o-mini fabricates plausible answers
 * (it was observed inventing 50–60/100 rationales for a silent call). A call
 * with no candidate speech is, objectively, a zero — so we record that in code
 * without an OpenAI round-trip, fully reproducible and traceable.
 */
function noCandidateSpeechEvidence(
  questions: { id: string }[],
): AnswerScoringEvidence {
  return {
    result: {
      overall_score: 0,
      overall_rationale:
        "No spoken response was captured in this call — the candidate did not answer any questions.",
      answers: questions.map((q) => ({
        question_id: q.id,
        score: 0,
        rationale: "No spoken response was captured for this question.",
      })),
    },
    rawOutput: JSON.stringify({ skipped: "no_candidate_speech" }),
    model: SCREENING_SCORING_MODEL,
    promptVersion: SCREENING_VOICE_SCORING_PROMPT_VERSION,
  };
}

/**
 * AI-scores a candidate's voice-screening call (#84) against the screening
 * questions, reading the spoken transcript instead of typed answers.
 *
 * The candidate answers a question whenever it comes up in conversation — not
 * in neat per-question slots — so the model is asked to locate each question's
 * evidence across the whole transcript and cite a short spoken excerpt in its
 * rationale (PRD 3.4.3: scores must trace back to the transcript). Returns the
 * same `AnswerScoringEvidence` shape as `scoreAnswers`, so the action persists
 * scores and runs the unchanged decision rule identically for both modalities.
 */
export async function scoreTranscript(params: {
  jobDescription: string;
  questions: { id: string; prompt: string; is_required: boolean }[];
  transcript: VoiceTranscriptTurn[];
}): Promise<AnswerScoringEvidence> {
  const { jobDescription, questions, transcript } = params;

  // Never feed the model a transcript with no candidate turns — it scores the
  // absence by hallucinating answers. This is the authoritative backstop for
  // every scoring path (recruiter re-score AND the auto-score on completion).
  if (!transcript.some((t) => t.role === "candidate")) {
    return noCandidateSpeechEvidence(questions);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const questionList = questions
    .map((q) => `- [${q.id}]${q.is_required ? " (required)" : ""} ${q.prompt}`)
    .join("\n");

  const conversation = transcript
    .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: SCREENING_SCORING_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert ATS evaluator scoring a spoken screening interview from its transcript. The interviewer asked a fixed set of questions (with unscripted follow-ups); the candidate answered conversationally. For each listed question, find the candidate's relevant spoken evidence anywhere in the transcript and score it 0-100 based on:
- Relevance and specificity (did they actually address the question?)
- Concrete evidence (examples, metrics, outcomes)
- Depth of reasoning
- Alignment with the role

Scoring a non-answer (critical):
- If the candidate never addressed a question — it was never asked, the call ended before reaching it, or they deflected ("I don't know", "I'm not sure", silence) — score it exactly 0.
- Do NOT award any credit for general enthusiasm, stated interest, or merely mentioning a topic. Points require the candidate actually answering THAT question with relevant substance.
- For each question set "evidence_quote" to the candidate's own words, copied VERBATIM from the transcript, that justify the score. Quote only the Candidate, never the Interviewer. If the candidate did not substantively address the question, set "evidence_quote" to an empty string and score it 0.

Then compute an overall_score as the simple average of per-question scores (0-100, rounded).

Return JSON in this exact format:
{
  "overall_score": number,
  "overall_rationale": "2-3 sentence summary of the candidate's screening performance",
  "answers": [
    { "question_id": "string", "score": number, "rationale": "1-2 sentences citing the transcript", "evidence_quote": "verbatim candidate words, or empty string if unaddressed" }
  ]
}

Rules:
- answers array must have exactly one entry per listed question, in the same order
- question_id must match the listed id verbatim`,
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
    throw new Error("OpenAI returned an empty response for transcript scoring");
  }

  return {
    result: enforceTranscriptEvidence(normalizeScoringResult(content), content, transcript),
    rawOutput: content,
    model: SCREENING_SCORING_MODEL,
    promptVersion: SCREENING_VOICE_SCORING_PROMPT_VERSION,
  };
}

/** Lowercase + strip non-alphanumerics so a verbatim quote survives minor
 * punctuation/spacing differences but a fabricated one does not match. */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Voice backstop (Control > AI > Data): a non-zero per-question score may only
 * stand if the model grounded it in a candidate quote that actually appears in
 * the transcript. The conversational format makes per-question scoring the AI's
 * job, but it has been observed inventing partial credit (e.g. "showed general
 * interest") for questions the candidate never reached. So any score whose
 * evidence_quote is empty or not found in the candidate's own speech is forced
 * to 0, and the overall is recomputed from the corrected scores.
 */
function enforceTranscriptEvidence(
  result: AnswerScoringResult,
  rawContent: string,
  transcript: VoiceTranscriptTurn[],
): AnswerScoringResult {
  let rawAnswers: { question_id?: unknown; evidence_quote?: unknown }[] = [];
  try {
    const parsed = JSON.parse(rawContent) as {
      answers?: { question_id?: unknown; evidence_quote?: unknown }[];
    };
    rawAnswers = parsed.answers ?? [];
  } catch {
    rawAnswers = [];
  }

  const quoteByQuestion = new Map<string, string>();
  for (const a of rawAnswers) {
    if (a?.question_id != null) {
      quoteByQuestion.set(
        String(a.question_id),
        typeof a.evidence_quote === "string" ? a.evidence_quote : "",
      );
    }
  }

  const candidateSpeech = normalizeForMatch(
    transcript.filter((t) => t.role === "candidate").map((t) => t.text).join(" "),
  );

  let changed = false;
  const answers = result.answers.map((a) => {
    if (a.score === 0) return a;
    const quote = normalizeForMatch(quoteByQuestion.get(a.question_id) ?? "");
    const grounded = quote.length > 0 && candidateSpeech.includes(quote);
    if (grounded) return a;
    changed = true;
    return {
      ...a,
      score: 0,
      rationale:
        "Scored 0: no candidate answer to this question was found in the transcript.",
    };
  });

  if (!changed) return result;
  return { ...result, answers, overall_score: averageOverall(answers) };
}
