// Internal scoring core — intentionally NOT a "use server" module. It performs
// no auth of its own (callers own that: a recruiter session, or a verified
// candidate screening token) and must never be reachable as an RPC endpoint.

import { revalidatePath } from "next/cache";
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
  type ScoredScreeningAnswer,
} from "@/lib/screening-scoring";
import { analyzeTranscriptCadence } from "@/lib/screening/transcript-cadence";
import { fetchActiveRubricVersion } from "@/lib/data/campaigns";
import {
  transitionApplication,
  transitionApplicationAsSystem,
} from "@/lib/data/transitions";
import type { SupabaseDb } from "@/lib/supabase/types";
import { sendTransitionNotification } from "./transition-notifications";
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
    is_required: q.is_required,
  }));

  const [scoring, rubricVersion] = await Promise.all([
    isVoice
      ? scoreVoiceTranscript({
          jobDescription: input.description,
          questions: questionsForScoring,
          transcript,
        })
      : scoreLegacyTextAnswers({
          jobDescription: input.description,
          questions: questionsForScoring,
          answers: answerInputs,
        }),
    fetchActiveRubricVersion(campaignId, "screening_q", db),
  ]);

  // Soft "reads-as-scripted" cadence signal (#84): evidence for the recruiter,
  // NEVER an input to the advancement decision below (Control > AI > Data).
  const cadence = analyzeTranscriptCadence(transcript);

  const inputSnapshot = isVoice
    ? {
        modality: "voice",
        question_count: questions.length,
        question_ids: questions.map((q) => q.id),
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

  revalidatePath(`/campaigns/${campaignId}/candidates/${applicationId}`);
  revalidatePath(`/campaigns/${campaignId}`);

  return { overall_score: scoring.overall_score };
}

/**
 * One shape both modalities produce, so persistence and the decision rule stay
 * single-path. `rulesVersion` / `validationWarnings` are empty on the legacy
 * text path — it predates the evidence model and is not being converted.
 */
interface ScreeningScoringOutput {
  overall_score: number;
  overall_rationale: string;
  answers: {
    question_id: string;
    score: number;
    rationale: string;
    evidence_quote?: string;
    evidence_turn_index?: number | null;
    evidence_level?: EvidenceLevel;
  }[];
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
  questions: { id: string; prompt: string; is_required: boolean }[];
  transcript: { role: "agent" | "candidate"; text: string; at: string }[];
}): Promise<ScreeningScoringOutput> {
  const extracted = await extractTranscriptEvidence(params);

  const validated = validateScreeningEvidence({
    response: extracted.evidence,
    questionIds: params.questions.map((q) => q.id),
    candidateSpeech: buildCandidateSpeech(params.transcript),
  });

  const scored = calculateScreeningScore(validated);

  return {
    overall_score: scored.overall_score,
    overall_rationale: validated.extraction_summary,
    answers: scored.answers.map(toPersistedAnswer),
    model: extracted.model,
    promptVersion: extracted.promptVersion,
    rawOutput: extracted.rawOutput,
    rulesVersion: SCREENING_SCORING_RULES_VERSION,
    validationWarnings: scored.validation_warnings,
  };
}

/** Human-readable per-question rationale, assembled from what the model said. */
function toPersistedAnswer(answer: ScoredScreeningAnswer) {
  const firstItem = answer.evidence_items[0];
  const rationale =
    answer.notes?.trim() ||
    firstItem?.explanation?.trim() ||
    `No verified evidence for this question (${answer.evidence_level}).`;

  return {
    question_id: answer.question_id,
    score: answer.score,
    rationale,
    evidence_level: answer.evidence_level,
    // Only attached when a quote actually survived verification — the UI
    // distinguishes "we looked and found nothing" from "this predates evidence
    // capture", and writing an empty quote would collapse the two.
    ...(firstItem
      ? {
          evidence_quote: firstItem.quote.trim(),
          evidence_turn_index: firstItem.turn_index ?? null,
        }
      : {}),
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
  questions: { id: string; prompt: string; is_required: boolean }[];
  answers: { question_id: string; answer_text: string }[];
}): Promise<ScreeningScoringOutput> {
  const evidence = await scoreAnswers(params);

  return {
    overall_score: evidence.result.overall_score,
    overall_rationale: evidence.result.overall_rationale,
    answers: evidence.result.answers,
    model: evidence.model,
    promptVersion: evidence.promptVersion,
    rawOutput: evidence.rawOutput,
    rulesVersion: null,
    validationWarnings: [],
  };
}
