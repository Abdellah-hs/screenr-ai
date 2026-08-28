// Internal scoring core — intentionally NOT a "use server" module. It performs
// no auth of its own (the caller owns that: a recruiter session, or the
// candidate's verified interview token) and must never be reachable as an RPC
// endpoint.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AutomationMode, InterviewPersona } from "@/lib/constants";
import { INTERVIEW_PROMPT_VERSION } from "@/lib/services/interview";
import { extractInterviewEvidence } from "@/lib/services/interview-evidence";
import { buildCandidateSpeech } from "@/lib/scoring/transcript";
import { validateTranscriptEvidence } from "@/lib/scoring/transcript-evidence";
import {
  calculateInterviewScore,
  interviewScoringDimensions,
  INTERVIEW_SCORING_RULES_VERSION,
} from "@/lib/interview-scoring";
import { evaluateInterviewScoringOutcome } from "@/lib/rules/interview-scoring";
import { fetchInterviewRubricDimensions } from "@/lib/data/campaigns";
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
  /**
   * Campaign automation mode. Decides whether a scored interview advances to
   * `manager_review` on its own or rests for the recruiter. Defaults to the
   * cautious mode so an omitted value can never auto-advance anyone.
   */
  automationMode?: AutomationMode;
  /**
   * `auto` (the default) is the candidate's own submit: score, then let the
   * rule layer advance the application. `rescore` is a recruiter refreshing the
   * evidence — it writes a new score and audit row and **applies no
   * transition**.
   *
   * A re-score must not transition, and the reason is not merely that it would
   * be a no-op. The application has usually already passed through
   * `interview_scored`, so re-running the rule would either fail on an illegal
   * edge or, in `fully_auto`, push a candidate a manager is actively reviewing
   * back into `manager_review`. Same rule the resume re-score follows: fresh
   * evidence, untouched pipeline state.
   */
  mode?: "auto" | "rescore";
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

  // The rubric comes back with its own version on the SAME row, so this is one
  // read rather than the two it used to be.
  const { dimensions: rubricDimensions, version: rubricVersion } =
    await fetchInterviewRubricDimensions(campaignId, db);

  // The recruiter's rubric, or the default competency set when they have none.
  // Never an empty list — that would score every candidate 0.
  const dimensions = interviewScoringDimensions(rubricDimensions);

  // Three steps, deliberately separate: the model reports evidence, code checks
  // that evidence against what the candidate actually said, and only then does
  // arithmetic turn it into a number. The model never sees a scale, so it has
  // no way to express an opinion as a score.
  const evidence = await extractInterviewEvidence({
    jobDescription: input.description,
    resumeSummary: input.resumeSummary,
    dimensions,
    transcript,
  });

  const validated = validateTranscriptEvidence({
    response: evidence.evidence,
    dimensionIds: dimensions.map((d) => d.id),
    candidateSpeech: buildCandidateSpeech(transcript),
  });

  const scored = calculateInterviewScore(validated, dimensions);

  const score: InterviewScore = {
    overall_score: scored.overall_score,
    overall_rationale: validated.extraction_summary,
    // Empty on this path: the breakdown is `dimension_scores`, and a stored
    // score must say which unit it was graded in rather than being redrawn in
    // a unit it never used.
    dimensions: [],
    dimension_scores: scored.dimensions,
    rules_version: INTERVIEW_SCORING_RULES_VERSION,
    validation_warnings: scored.validation_warnings,
    strengths: [],
    concerns: [],
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
          // Which arithmetic, and what it graded against. Without these a
          // stored score cannot say whether it came from the rubric or from
          // the default set that stands in when a campaign has none.
          scoring_rules_version: INTERVIEW_SCORING_RULES_VERSION,
          rubric_dimensions: dimensions.map((d) => ({
            id: d.id,
            name: d.name,
            weight: d.weight,
          })),
          used_default_rubric: rubricDimensions.length === 0,
          validation_warnings: scored.validation_warnings,
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

  // A recruiter re-score stops here: the evidence is refreshed and the
  // application stays exactly where it was.
  if (input.mode === "rescore") {
    revalidatePath(`/campaigns/${campaignId}/candidates/${applicationId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return { overall_score: scored.overall_score };
  }

  // Rule layer decides the transition from the persisted score. Best-effort:
  // the score is durable; a failed transition just leaves a recruiter to
  // advance manually.
  const decisions = evaluateInterviewScoringOutcome(
    { overall_score: scored.overall_score },
    { automation_mode: input.automationMode ?? "human_in_loop" },
  );
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

  return { overall_score: scored.overall_score };
}
