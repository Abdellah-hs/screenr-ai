import { advanceApplicationStatus } from "@/lib/data/candidates";
import type { fetchCampaignScoringConfig } from "@/lib/data/campaigns";
import type { ResumeScoreResult } from "@/lib/actions/ai-generate";

export type CampaignScoringConfig = NonNullable<
  Awaited<ReturnType<typeof fetchCampaignScoringConfig>>
>;
export type { ResumeScoreResult };

/**
 * Rule layer — reads persisted resume-score evidence and decides the next
 * transition. Never calls the AI. Keeping this separate from scoring is what
 * makes AI output "advisory, not authoritative" (CLAUDE.md → AI Usage Rules).
 *
 * Behaviour:
 *   - fully_auto:    pass threshold → `screening_approved`; else → `rejected`.
 *   - human_in_loop: any score        → `screening_review_pending` so a
 *                    recruiter reviews before the application advances.
 *
 * Phase 6 of the decoupling refactor converts this to the descriptor style
 * (return `TransitionDescriptor`, let the caller execute the transition).
 */
export async function evaluateResumeScoringOutcome(
  applicationId: string,
  result: ResumeScoreResult,
  config: CampaignScoringConfig,
): Promise<void> {
  const scoreLine = `Resume score ${result.overall_score} vs threshold ${config.screening_threshold}`;

  if (config.automation_mode === "human_in_loop") {
    await advanceApplicationStatus(
      applicationId,
      "screening_review_pending",
      `${scoreLine} — awaiting recruiter review (HITL mode)`,
    );
    return;
  }

  if (result.overall_score >= config.screening_threshold) {
    await advanceApplicationStatus(
      applicationId,
      "screening_approved",
      `${scoreLine} — passed`,
    );
  } else {
    await advanceApplicationStatus(
      applicationId,
      "rejected",
      `${scoreLine} — below threshold`,
    );
  }
}
