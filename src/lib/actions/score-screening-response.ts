// Internal scoring core — intentionally NOT a "use server" module. It performs
// no auth of its own (callers own that: a recruiter session, or a verified
// candidate screening token) and must never be reachable as an RPC endpoint.

import { revalidatePath } from "next/cache";
import {
  scoreAnswers,
  scoreTranscript,
} from "@/lib/services/screening-questions";
import { analyzeTranscriptCadence } from "@/lib/screening/transcript-cadence";
import { fetchActiveRubricVersion } from "@/lib/data/campaigns";
import { transitionApplication } from "@/lib/data/transitions";
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
  const { applicationId, campaignId, candidateId, ownerUserId } = input;

  const [response, questions] = await Promise.all([
    fetchScreeningResponseByApplicationId(applicationId),
    fetchScreeningQuestionsByCampaignId(campaignId),
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

  const [evidence, rubricVersion] = await Promise.all([
    isVoice
      ? scoreTranscript({
          jobDescription: input.description,
          questions: questionsForScoring,
          transcript,
        })
      : scoreAnswers({
          jobDescription: input.description,
          questions: questionsForScoring,
          answers: answerInputs,
        }),
    fetchActiveRubricVersion(campaignId, "screening_q"),
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
      score: evidence.result.overall_score,
      rationale: evidence.result.overall_rationale,
    },
    perAnswer: evidence.result.answers,
    rubricVersion,
    audit: {
      model: evidence.model,
      promptVersion: evidence.promptVersion,
      rawOutput: evidence.rawOutput,
      inputSnapshot,
    },
  });

  // Rule layer decides the chain of transitions from the persisted score.
  // Best-effort: scores are durable; if a transition fails we stop the chain
  // (later steps would be illegal from a stuck state) and let a recruiter
  // advance manually.
  const decisions = evaluateScreeningScoringOutcome(
    { overall_score: evidence.result.overall_score },
    {
      automation_mode: input.automation_mode,
      screening_threshold: input.screening_threshold,
    },
  );

  for (const decision of decisions) {
    try {
      await transitionApplication({
        applicationId,
        toState: decision.toState,
        actor: "system",
        rationale: decision.rationale,
        disposition: decision.disposition,
      });
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

  return { overall_score: evidence.result.overall_score };
}
