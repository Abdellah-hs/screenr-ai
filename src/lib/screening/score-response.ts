// A screening-stage PIPELINE, not an action. It composes services -> data ->
// rules -> transition() on an injected `db`, and it has two entry points: the
// recruiter's re-score action and the candidate's token-verified submit.
//
// It lives HERE, and not in `lib/actions/`, because it performs no auth of its
// own — its callers do, with a session or a verified screening token — and a
// module in `actions/` is one `"use server"` away from being a public RPC
// endpoint that scores and transitions an application without checking anybody.
// A directory where nothing is ever an action makes that structural rather than
// a comment somebody has to keep believing.
//
// Pipelines do not revalidate either: the two callers own that, because they
// are the ones that know a recruiter is looking at a page.

import { scoreAnswers } from "@/lib/services/screening-questions";
import {
  buildCandidateSpeech,
  extractTranscriptEvidence,
} from "@/lib/services/screening-evidence";
import {
  calculateScreeningScore,
  validateScreeningEvidence,
  SCREENING_SCORING_RULES_VERSION,
  type EvidenceLevel,
  type ScoredScreeningDimension,
  type ScreeningDimension,
} from "@/lib/screening-scoring";
import { analyzeTranscriptCadence } from "./transcript-cadence";
import { SCREENING_PROMPT_VERSION } from "@/lib/services/realtime";
import { fetchScreeningRubricDimensions } from "@/lib/data/campaigns";
import {
  transitionApplication,
  transitionApplicationAsSystem,
} from "@/lib/data/transitions";
import type { SupabaseDb } from "@/lib/supabase/types";
import { sendTransitionNotification } from "@/lib/actions/transition-notifications";
import { evaluateScreeningScoringOutcome } from "@/lib/rules/screening-response";
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  saveAnswerScores,
} from "@/lib/data/screening-questions";

export interface RunScreeningScoringInput {
  applicationId: string;
  campaignId: string;
  candidateId: string;
  /** Campaign owner — used to attribute transition notifications. */
  ownerUserId: string;
  /** Job description; the AI scorer needs it for context. */
  description: string;
  automation_mode: "fully_auto" | "human_in_loop";
  screening_threshold: number;
  /**
   * Service-role client, supplied by the candidate-side auto-score: that path
   * runs on a verified screening token with no recruiter session, and every
   * table below is owner-only RLS. Omitted by the recruiter-triggered path,
   * which keeps its cookie-scoped session client and the ownership checks that
   * come with it.
   */
  db?: SupabaseDb;
}

/**
 * Shared scoring core behind both the recruiter-triggered `scoreScreeningAnswers`
 * and the candidate-triggered voice auto-score. Voice (transcript) and legacy
 * text answers differ only in how the AI score is produced — persistence and the
 * decision rule are identical.
 *
 * Control > AI > Data: AI produces the score (evidence); the rule layer
 * (`evaluateScreeningScoringOutcome`) decides the transitions from that evidence
 * + campaign config. HITL rests at `screening_scored`; fully_auto chains through
 * to `interview_invited` (pass) or `rejected` (fail).
 *
 * Throws if the response is missing or not in the `responded` state — callers
 * that can't surface an error to a user (the candidate path) run this
 * best-effort and log instead.
 */
export async function runScreeningScoring(
  input: RunScreeningScoringInput
): Promise<{ overall_score: number }> {
  const { applicationId, campaignId, candidateId, ownerUserId, db } = input;

  const [response, questions] = await Promise.all([
    fetchScreeningResponseByApplicationId(applicationId, db),
    fetchScreeningQuestionsByCampaignId(campaignId, db),
  ]);

  if (!response) throw new Error("No screening response to score");
  if (response.status !== "responded") {
    throw new Error(
      `Screening response for ${applicationId} is not ready to score (status: ${response.status})`
    );
  }

  const answerInputs = (response.answers ?? []).map((a) => ({
    question_id: a.question_id,
    answer_text: a.answer_text ?? "",
  }));

  // A non-empty transcript means this was a voice call (#84): score the spoken
  // transcript rather than typed answers. Everything downstream is identical.
  const transcript = response.transcript ?? [];
  const isVoice = transcript.length > 0;
  const questionsForScoring = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
  }));

  // One read: the dimensions and the version this score is stamped with live
  // on the same `evaluation_rubrics` row.
  const { dimensions: rubricDimensions, version: rubricVersion } =
    await fetchScreeningRubricDimensions(campaignId, db);

  const scoring = isVoice
    ? await scoreVoiceTranscript({
        jobDescription: input.description,
        dimensions: scoringDimensions(rubricDimensions, questionsForScoring),
        questions: questionsForScoring,
        transcript,
      })
    : await scoreLegacyTextAnswers({
        jobDescription: input.description,
        questions: questionsForScoring,
        answers: answerInputs,
      });

  // Soft "reads-as-scripted" cadence signal (#84): evidence for the recruiter,
  // NEVER an input to the advancement decision below (Control > AI > Data).
  const cadence = analyzeTranscriptCadence(transcript);

  const inputSnapshot = isVoice
    ? {
        modality: "voice",
        question_count: questions.length,
        question_ids: questions.map((q) => q.id),
        // Which rubric the call was graded against, and whether it was a rubric
        // at all. `scoring_unit: "question"` records that the campaign had no
        // screening rubric and each question stood in as its own dimension —
        // without it, a rubric added later would make an old score look as
        // though it had been graded on a rubric that did not exist yet.
        scoring_unit: rubricDimensions.length > 0 ? "rubric_dimension" : "question",
        // Which INTERVIEWER produced this transcript. `prompt_version` on the
        // audit row is the SCORER's version; a screening score cannot be read
        // back in context without knowing how the call that produced it was
        // paced and instructed. Stamped at scoring time, so a re-score of an
        // old transcript records today's interviewer — same caveat as
        // `interview_prompt_version`.
        screening_prompt_version: SCREENING_PROMPT_VERSION,
        rubric_dimensions: rubricDimensions.map((d) => ({
          id: d.id,
          name: d.name,
          weight: d.weight,
        })),
        transcript_turns: transcript.length,
        cadence_signal: {
          scripted_signal: cadence.scripted_signal,
          median_response_seconds: cadence.median_response_seconds,
          measured_responses: cadence.measured_responses,
          rationale: cadence.rationale,
        },
        job_description_length: input.description.length,
      }
    : {
        modality: "text",
        question_count: questions.length,
        question_ids: questions.map((q) => q.id),
        answered_count: answerInputs.filter((a) => a.answer_text.trim().length > 0).length,
        job_description_length: input.description.length,
      };

  await saveAnswerScores({
    applicationId,
    campaignId,
    candidateId,
    overall: {
      score: scoring.overall_score,
      rationale: scoring.overall_rationale,
    },
    perAnswer: scoring.answers,
    perDimension: scoring.dimensions,
    rubricVersion,
    audit: {
      model: scoring.model,
      promptVersion: scoring.promptVersion,
      rawOutput: scoring.rawOutput,
      inputSnapshot: {
        ...inputSnapshot,
        // The arithmetic that turned evidence levels into this score, and every
        // correction made to the model's claims on the way. Stored because a
        // score whose rules are not recorded cannot be re-checked later.
        scoring_rules_version: scoring.rulesVersion,
        validation_warnings: scoring.validationWarnings,
      },
    },
    db,
  });

  // Rule layer decides the chain of transitions from the persisted score.
  // Best-effort: scores are durable; if a transition fails we stop the chain
  // (later steps would be illegal from a stuck state) and let a recruiter
  // advance manually.
  const decisions = evaluateScreeningScoringOutcome(
    { overall_score: scoring.overall_score },
    {
      automation_mode: input.automation_mode,
      screening_threshold: input.screening_threshold,
    },
  );

  for (const decision of decisions) {
    try {
      // A candidate-side auto-score (injected `db`, no recruiter session) must
      // use the system transition: `transitionApplication` reads through the
      // cookie client and its RPC enforces an owner check that an anonymous
      // request cannot satisfy. The actor is `system` either way — what differs
      // is only which client carries the write.
      if (db) {
        await transitionApplicationAsSystem(
          applicationId,
          decision.toState,
          decision.rationale,
          decision.disposition,
        );
      } else {
        await transitionApplication({
          applicationId,
          toState: decision.toState,
          actor: "system",
          rationale: decision.rationale,
          disposition: decision.disposition,
        });
      }
      await sendTransitionNotification(applicationId, decision.toState, ownerUserId);
    } catch (err) {
      console.error(
        `Failed to transition ${applicationId} → ${decision.toState}:`,
        err instanceof Error ? err.message : err,
      );
      break;
    }
  }

  return { overall_score: scoring.overall_score };
}

/**
 * What the call is scored against.
 *
 * Normally the recruiter's screening rubric. When a campaign has none — it was
 * created before the rubric mattered, or the recruiter emptied the tab — each
 * question stands in as its own dimension at equal weight, which reproduces the
 * old unweighted per-question mean *exactly*, through the same code path.
 *
 * That is the whole reason there is no second scorer for rubric-less campaigns:
 * a fallback that runs different arithmetic is a fallback nobody tests and
 * everybody eventually has to debug. This one is the general case with a
 * degenerate rubric.
 */
function scoringDimensions(
  rubricDimensions: ScreeningDimension[],
  questions: { id: string; prompt: string }[],
): ScreeningDimension[] {
  if (rubricDimensions.length > 0) return rubricDimensions;
  return questions.map((q) => ({ id: q.id, name: q.prompt, weight: 1 }));
}

/**
 * One shape both modalities produce, so persistence and the decision rule stay
 * single-path.
 *
 * Exactly one of `dimensions` / `answers` is populated, and which one says how
 * the score was made: the voice path grades rubric dimensions, the legacy text
 * path grades questions. They are not merged into one field because a reader
 * has to be able to tell which unit a stored score came from — the two are not
 * interchangeable, and a single `items` array would hide that.
 *
 * `rulesVersion` / `validationWarnings` are empty on the legacy text path — it
 * predates the evidence model and is not being converted.
 */
interface ScreeningScoringOutput {
  overall_score: number;
  overall_rationale: string;
  /** Per rubric dimension — the voice path. */
  dimensions: ScoredScreeningDimension[] | null;
  /** Per question — the legacy text path only. */
  answers:
    | {
        question_id: string;
        score: number;
        rationale: string;
        evidence_quote?: string;
        evidence_turn_index?: number | null;
        evidence_level?: EvidenceLevel;
      }[]
    | null;
  model: string;
  promptVersion: string;
  rawOutput: string;
  rulesVersion: string | null;
  validationWarnings: string[];
}

/**
 * Voice path — the live one since #161.
 *
 * Three steps, deliberately separate: the model reports evidence, code checks
 * that evidence against what the candidate actually said, and only then does
 * arithmetic turn it into a number. The model never sees a scale, so it has no
 * way to express an opinion as a score.
 */
async function scoreVoiceTranscript(params: {
  jobDescription: string;
  dimensions: ScreeningDimension[];
  questions: { id: string; prompt: string }[];
  transcript: { role: "agent" | "candidate"; text: string; at: string }[];
}): Promise<ScreeningScoringOutput> {
  const extracted = await extractTranscriptEvidence(params);

  const validated = validateScreeningEvidence({
    response: extracted.evidence,
    dimensionIds: params.dimensions.map((d) => d.id),
    candidateSpeech: buildCandidateSpeech(params.transcript),
  });

  const scored = calculateScreeningScore(validated, params.dimensions);

  return {
    overall_score: scored.overall_score,
    overall_rationale: validated.extraction_summary,
    dimensions: scored.dimensions,
    answers: null,
    model: extracted.model,
    promptVersion: extracted.promptVersion,
    rawOutput: extracted.rawOutput,
    rulesVersion: SCREENING_SCORING_RULES_VERSION,
    validationWarnings: scored.validation_warnings,
  };
}

/**
 * Legacy text path. The typed-answer form was retired in #161, so this only
 * runs when a recruiter re-scores a response captured before that. Left on the
 * old numeric scorer on purpose: converting a path no new response can reach
 * would add a second evidence prompt to maintain for no live benefit.
 */
async function scoreLegacyTextAnswers(params: {
  jobDescription: string;
  questions: { id: string; prompt: string }[];
  answers: { question_id: string; answer_text: string }[];
}): Promise<ScreeningScoringOutput> {
  const evidence = await scoreAnswers(params);

  return {
    overall_score: evidence.result.overall_score,
    overall_rationale: evidence.result.overall_rationale,
    dimensions: null,
    answers: evidence.result.answers,
    model: evidence.model,
    promptVersion: evidence.promptVersion,
    rawOutput: evidence.rawOutput,
    rulesVersion: null,
    validationWarnings: [],
  };
}
