// Internal scoring core — intentionally NOT a "use server" module. It performs
// no auth of its own (the caller owns that: a recruiter session, or the
// candidate's verified interview token) and must never be reachable as an RPC
// endpoint.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InterviewPersona } from "@/lib/constants";
import { INTERVIEW_PROMPT_VERSION } from "@/lib/services/interview";
import { scoreInterview } from "@/lib/services/interview-scoring";
import { evaluateInterviewScoringOutcome } from "@/lib/rules/interview-scoring";
import { fetchActiveRubricVersion } from "@/lib/data/campaigns";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";
import {
  fetchInterviewSessionByApplicationId,
  saveInterviewScore,
  type InterviewScore,
} from "@/lib/data/interview-sessions";

export interface RunInterviewScoringInput {
  applicationId: string;
  campaignId: string;
  candidateId: string;
  /** Campaign owner — reserved for future notification attribution. */
  ownerUserId: string;
  /** Job description; the AI scorer needs it for context. */
  description: string;
  /** Short résumé summary for scoring context (optional). */
  resumeSummary?: string | null;
  /**
   * The stance the interview was actually conducted under. Recorded as evidence
   * only — it does NOT change how the transcript is scored. A "pressure"
   * transcript reads differently from a "collaborative" one, so a later reviewer
   * needs to know which conversation produced the score (PRD 3.5.8).
   */
  persona?: InterviewPersona;
}

/**
 * Scoring core for a completed AI interview. Mirrors `runScreeningScoring`:
 * Control > AI > Data — the AI produces the score (evidence), the rule layer
 * (`evaluateInterviewScoringOutcome`) decides the transition, and this executes
 * it. Interview scoring is record-only, so it advances
 * `interview_completed → interview_scored` and rests there for manager review.
 *
 * Runs on the admin client throughout: the auto-score fires in the candidate's
 * session-less submit request, so a cookie client would be blanked by RLS on
 * the interview session / application reads and writes.
 *
 * Throws if the session is missing or not `completed` — the candidate-path
 * caller runs this best-effort and logs rather than surfacing the error.
 */
export async function runInterviewScoring(
  input: RunInterviewScoringInput,
): Promise<{ overall_score: number }> {
  const { applicationId, campaignId, candidateId } = input;
  const db = createAdminClient();

  const session = await fetchInterviewSessionByApplicationId(applicationId, db);
  if (!session) throw new Error("No interview session to score");
  if (session.status !== "completed") {
    throw new Error(
      `Interview for ${applicationId} is not ready to score (status: ${session.status})`,
    );
  }

  const transcript = session.transcript ?? [];

  const [evidence, rubricVersion] = await Promise.all([
    scoreInterview({
      jobDescription: input.description,
      resumeSummary: input.resumeSummary,
      transcript,
    }),
    fetchActiveRubricVersion(campaignId, "interview", db),
  ]);

  const score: InterviewScore = {
    overall_score: evidence.result.overall_score,
    overall_rationale: evidence.result.overall_rationale,
    dimensions: evidence.result.dimensions.map((d) => ({
      name: d.name,
      score: d.score,
      rationale: d.rationale,
    })),
    strengths: evidence.result.strengths,
    concerns: evidence.result.concerns,
    rubric_version: rubricVersion,
    scored_at: new Date().toISOString(),
  };

  await saveInterviewScore(
    {
      applicationId,
      campaignId,
      candidateId,
      score,
      audit: {
        model: evidence.model,
        promptVersion: evidence.promptVersion,
        rawOutput: evidence.rawOutput,
        inputSnapshot: {
          transcript_turns: transcript.length,
          job_description_length: input.description.length,
          // Which conversation produced this transcript. `prompt_version` on the
          // audit row is the SCORER's version; these two describe the interview
          // itself, without which a score can't be read back in context.
          interview_persona: input.persona ?? "neutral",
          interview_prompt_version: INTERVIEW_PROMPT_VERSION,
        },
      },
    },
    db,
  );

  // Rule layer decides the transition from the persisted score. Best-effort:
  // the score is durable; a failed transition just leaves a recruiter to
  // advance manually.
  const decisions = evaluateInterviewScoringOutcome({
    overall_score: evidence.result.overall_score,
  });
  for (const decision of decisions) {
    try {
      await transitionApplicationAsSystem(applicationId, decision.toState, decision.rationale);
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
