import OpenAI from "openai";
import type { InterviewTranscriptTurn } from "@/lib/data/interview-sessions";
import { isGrounded, locateEvidence } from "@/lib/scoring/evidence";

/**
 * AI scoring for the on-demand AI video interview (Phase B). The interview
 * analogue of `scoreTranscript` in `screening-questions.ts`: it reads the
 * conversational transcript and produces per-competency scores + an overall +
 * strengths/concerns, each grounded in a verbatim candidate quote.
 *
 * Control > AI > Data: this produces EVIDENCE only. The rule layer
 * (`evaluateInterviewScoringOutcome`) turns the persisted score into a
 * transition; the AI never advances state. The same anti-hallucination
 * backstops as the voice scorer apply: a call with no candidate speech is a
 * deterministic zero (no model round-trip), and any non-zero dimension whose
 * evidence quote isn't actually in the candidate's speech is forced to 0.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const INTERVIEW_SCORING_MODEL = "gpt-4o-mini";
export const INTERVIEW_SCORING_PROMPT_VERSION = "v1_interview_scoring";

export interface InterviewDimensionScore {
  name: string;
  score: number;
  rationale: string;
  evidence_quote: string;
  /**
   * Index of the transcript turn the quote was found in, or null when it could
   * not be pinned to a single utterance. Set by `enforceEvidence`, which
   * already has to locate the quote to verify it — this is the position that
   * used to be computed and thrown away.
   */
  evidence_turn_index: number | null;
}

export interface InterviewScoringResult {
  overall_score: number;
  overall_rationale: string;
  dimensions: InterviewDimensionScore[];
  strengths: string[];
  concerns: string[];
}

export interface InterviewScoringEvidence {
  result: InterviewScoringResult;
  rawOutput: string;
  model: string;
  promptVersion: string;
}

/** Deterministic zero for a call the candidate never spoke in — we never ask
 *  the model to score an absence (it hallucinates plausible answers). */
function noCandidateSpeechEvidence(): InterviewScoringEvidence {
  return {
    result: {
      overall_score: 0,
      overall_rationale:
        "No spoken response was captured in this interview — the candidate did not answer any questions.",
      dimensions: [],
      strengths: [],
      concerns: ["The candidate did not provide any spoken responses during the interview."],
    },
    rawOutput: JSON.stringify({ skipped: "no_candidate_speech" }),
    model: INTERVIEW_SCORING_MODEL,
    promptVersion: INTERVIEW_SCORING_PROMPT_VERSION,
  };
}

export async function scoreInterview(params: {
  jobDescription: string;
  resumeSummary?: string | null;
  transcript: InterviewTranscriptTurn[];
  /** Optional competency names to steer the evaluation (e.g. campaign interview rubric dims). */
  focusAreas?: string[];
}): Promise<InterviewScoringEvidence> {
  const { jobDescription, resumeSummary, transcript, focusAreas } = params;

  if (!transcript.some((t) => t.role === "candidate")) {
    return noCandidateSpeechEvidence();
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const conversation = transcript
    .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");

  const focusLine =
    focusAreas && focusAreas.length > 0
      ? `\n\n## Competencies to weigh\n${focusAreas.map((f) => `- ${f}`).join("\n")}`
      : "";

  const response = await openai.chat.completions.create({
    model: INTERVIEW_SCORING_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert technical interviewer evaluating a candidate from the transcript of a live AI-led interview. Identify the competencies the role actually calls for (e.g. technical depth, problem-solving, system design, communication, role fit) and score each 0-100 based on:
- Relevance and specificity (did they demonstrate the competency?)
- Concrete evidence (examples, metrics, decisions, trade-offs)
- Depth of reasoning
- Alignment with the role

Scoring rules (critical):
- Base every score ONLY on what the candidate actually said. Do NOT reward general enthusiasm, stated interest, or merely naming a topic.
- For each competency set "evidence_quote" to the candidate's own words, copied VERBATIM from the transcript, that justify the score. Quote only the Candidate, never the Interviewer. If the candidate never demonstrated the competency, set score 0 and "evidence_quote" to an empty string.
- overall_score is the simple average of the competency scores (0-100, rounded).
- strengths: 2-4 short phrases naming what the candidate did well (may be empty).
- concerns: 0-4 short phrases naming gaps or risks (may be empty).

Return JSON in this exact format:
{
  "overall_score": number,
  "overall_rationale": "2-3 sentence summary of the candidate's interview performance",
  "dimensions": [
    { "name": "string", "score": number, "rationale": "1-2 sentences citing the transcript", "evidence_quote": "verbatim candidate words, or empty string" }
  ],
  "strengths": ["string"],
  "concerns": ["string"]
}`,
      },
      {
        role: "user",
        content: `## Job Description
${jobDescription}
${resumeSummary ? `\n## Candidate Background\n${resumeSummary}` : ""}${focusLine}

## Interview Transcript
${conversation}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for interview scoring");
  }

  return {
    result: enforceEvidence(normalizeResult(content), transcript),
    rawOutput: content,
    model: INTERVIEW_SCORING_MODEL,
    promptVersion: INTERVIEW_SCORING_PROMPT_VERSION,
  };
}

function averageOverall(dimensions: InterviewDimensionScore[]): number {
  if (dimensions.length === 0) return 0;
  return Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
}

function normalizeResult(content: string): InterviewScoringResult {
  const parsed = JSON.parse(content) as Partial<InterviewScoringResult>;
  const dimensions = (parsed.dimensions ?? []).map((d) => ({
    name: String(d.name ?? "").trim() || "Competency",
    score: Math.max(0, Math.min(100, Math.round(Number(d.score) || 0))),
    rationale: String(d.rationale ?? ""),
    evidence_quote: typeof d.evidence_quote === "string" ? d.evidence_quote : "",
    // Filled in by `enforceEvidence`, which is the only place with the
    // transcript to locate it against.
    evidence_turn_index: null,
  }));

  return {
    overall_score: Math.max(0, Math.min(100, Math.round(Number(parsed.overall_score) || 0))),
    overall_rationale: parsed.overall_rationale || "No rationale provided.",
    dimensions,
    strengths: (parsed.strengths ?? []).map((s) => String(s)).filter(Boolean),
    concerns: (parsed.concerns ?? []).map((s) => String(s)).filter(Boolean),
  };
}

/**
 * Backstop (Control > AI > Data): a non-zero dimension score may only stand if
 * grounded in a candidate quote that actually appears in the transcript. Any
 * ungrounded non-zero score is forced to 0 and the overall recomputed — so an
 * invented "managed a team of twelve" can't inflate the result.
 *
 * It also records WHERE the quote was found, so the score can be traced back to
 * the words behind it (PRD 3.10.2). Locating is a strictly narrower question
 * than grounding — a quote stitched across two turns is still grounded but
 * cannot be linked to one utterance — so the two are asked separately and only
 * `isGrounded` may zero a score. Otherwise adding a UI feature would quietly
 * start demoting scores that used to stand.
 */
function enforceEvidence(
  result: InterviewScoringResult,
  transcript: InterviewTranscriptTurn[],
): InterviewScoringResult {
  const dimensions = result.dimensions.map((d) => {
    if (d.score === 0) return d;
    if (!isGrounded(d.evidence_quote, transcript)) {
      return {
        ...d,
        score: 0,
        evidence_turn_index: null,
        rationale: "Scored 0: no supporting candidate quote for this competency was found in the transcript.",
      };
    }
    return {
      ...d,
      evidence_turn_index: locateEvidence(d.evidence_quote, transcript)?.turnIndex ?? null,
    };
  });

  // The overall is always the code-side average of the (corrected) dimension
  // scores, never the model's self-reported number.
  return { ...result, dimensions, overall_score: averageOverall(dimensions) };
}
