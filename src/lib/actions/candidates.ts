"use server";

import { revalidatePath } from "next/cache";
import {
  uuidSchema,
  applicationStateSchema,
  stageChangeRationaleSchema,
  hitlReviewDecisionSchema,
} from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { transitionApplication } from "@/lib/data/transitions";
import { assertRecruiterSettableTarget } from "@/lib/rules/manual-stage-change";
import { sendTransitionNotification } from "./transition-notifications";
import { sendScreeningQuestionsToCandidate } from "./screening-questions";
import { assertCampaignActiveById } from "./campaign-guards";

// Services
import {
  scoreResumeAgainstCriteria,
  type ParsedResumeData,
} from "@/lib/services/openai";

// Data Access
import {
  fetchCandidatesByCampaignId,
  fetchCandidateById,
  updateApplicationStage,
  advanceApplicationStatus,
  getResumeSignedUrl,
  saveResumeScore,
  fetchApplicationCampaignId,
} from "@/lib/data/candidates";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
  fetchCampaignStatus,
} from "@/lib/data/campaigns";
import { fetchScreeningQuestionsByCampaignId } from "@/lib/data/screening-questions";
import { isCampaignProcessingActive } from "@/lib/rules/campaign-status";

// Rules
import {
  evaluateResumeScoringOutcome,
  assertResumeRescoreAllowed,
  type CampaignScoringConfig,
  type ResumeScoreResult,
} from "@/lib/rules/resume-scoring";
import { toCandidateStage } from "@/lib/constants";
import type { ApplicationState, Candidate, CandidateScore, ScoreFactor, ScreeningTier } from "@/lib/constants";
import type { Database } from "@/types/database.types";

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type ScreeningResponseScoreRow = Pick<
  Database["public"]["Tables"]["screening_question_responses"]["Row"],
  "overall_score" | "overall_rationale" | "scored_at" | "rubric_version" | "status"
>;
type ApplicationWithCandidate = ApplicationRow & {
  candidates: CandidateRow;
  // The embedded screening response. `screening_question_responses` has a
  // UNIQUE(application_id), so PostgREST returns a single object (or null) for
  // this one-to-one embed — not an array. Typed permissively to tolerate both.
  screening_question_responses:
    | ScreeningResponseScoreRow
    | ScreeningResponseScoreRow[]
    | null;
};
type CandidateStageEnum = Database["public"]["Enums"]["candidate_stage_enum"];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds the per-stage score array — one entry per stage that has produced a
 * score, in pipeline order (resume → screening → …). Each stage's score is
 * independent evidence (CLAUDE.md "Independent Stage Scores"); there is no
 * rollup. The resume score lives on the application row; the screening score
 * lives on the joined screening_question_responses row (it is only included
 * once that response has been scored).
 */
function buildScoresArray(
  row: Pick<ApplicationRow, "resume_score" | "screening_tier" | "score_rationale" | "score_factors" | "scored_at" | "created_at" | "rubric_version">,
  currentResumeRubricVersion: number | null,
  screeningResponse: ScreeningResponseScoreRow | null,
  currentScreeningRubricVersion: number | null,
): CandidateScore[] {
  const scores: CandidateScore[] = [];

  if (row.resume_score != null) {
    scores.push({
      stage: "resume",
      overall: Number(row.resume_score),
      tier: (row.screening_tier as ScreeningTier | null) || undefined,
      ai_summary: row.score_rationale || "Scored by AI",
      factors: (row.score_factors as ScoreFactor[] | null) || [],
      scored_at: row.scored_at || row.created_at,
      rubric_version: row.rubric_version,
      current_rubric_version: currentResumeRubricVersion,
    });
  }

  if (screeningResponse?.status === "scored" && screeningResponse.overall_score != null) {
    scores.push({
      stage: "screening",
      overall: Number(screeningResponse.overall_score),
      ai_summary: screeningResponse.overall_rationale || "Scored by AI",
      factors: [],
      scored_at: screeningResponse.scored_at || row.created_at,
      rubric_version: screeningResponse.rubric_version,
      current_rubric_version: currentScreeningRubricVersion,
    });
  }

  return scores;
}

/**
 * The scored screening response for an application, if any. Tolerates the embed
 * arriving as a single object (the one-to-one case PostgREST actually returns)
 * or an array, and only counts a response that has reached the `scored` status.
 */
function scoredScreeningResponse(
  responses: ScreeningResponseScoreRow | ScreeningResponseScoreRow[] | null,
): ScreeningResponseScoreRow | null {
  if (!responses) return null;
  const response = Array.isArray(responses)
    ? responses.find((r) => r.status === "scored") ?? null
    : responses;
  return response?.status === "scored" ? response : null;
}

/**
 * Fully-auto auto-send. Resume scoring only advances an application straight to
 * `screening_approved` in fully_auto mode — human_in_loop routes to
 * `screening_review_pending` and sends on the recruiter's manual approval. So
 * when scoring lands on `screening_approved`, email the screening questions
 * right away (mirroring what HITL approval does) instead of leaving the
 * candidate stranded waiting for a button press. Best-effort: a missing
 * question set or send failure must NOT undo the scoring, so it is logged, not
 * thrown — the candidate stays approved and a recruiter can resend manually.
 */
async function autoSendScreeningIfApproved(
  applicationId: string,
  toState: ApplicationState,
): Promise<void> {
  if (toState !== "screening_approved") return;
  try {
    await sendScreeningQuestionsToCandidate(applicationId);
  } catch (err) {
    console.warn(
      `Auto-send screening questions failed for ${applicationId} (non-blocking):`,
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Regular Fetch Functions ──────────────────────────────────────────────

export async function getCandidatesByCampaignId(campaignId: string): Promise<Candidate[]> {
  uuidSchema.parse(campaignId);
  const userId = await requireUserId();
  const [data, currentResumeRubricVersion, currentScreeningRubricVersion] = await Promise.all([
    fetchCandidatesByCampaignId(campaignId, userId),
    fetchActiveRubricVersion(campaignId, "resume"),
    fetchActiveRubricVersion(campaignId, "screening_q"),
  ]);
  if (!data) return [];

  return (data as ApplicationWithCandidate[]).map((app) => {
    const parsed = app.parsed_data as ParsedResumeData | null;
    return {
      id: app.id,
      campaign_id: app.campaign_id,
      name: `${app.candidates.first_name} ${app.candidates.last_name}`,
      email: app.candidates.email,
      phone: app.candidates.phone,
      current_title: parsed?.experience?.[0]?.title || null,
      current_company: parsed?.experience?.[0]?.company || null,
      stage: toCandidateStage(app.status),
      awaiting_human_review: app.status === "screening_review_pending",
      is_archived: app.status === "archived",
      scores: buildScoresArray(
        app,
        currentResumeRubricVersion,
        scoredScreeningResponse(app.screening_question_responses),
        currentScreeningRubricVersion,
      ),
      resume: {
        skills: parsed?.skills || [],
        experience_years: parsed?.experience?.length || 0,
        education: parsed?.education?.[0]?.institution || "Unknown",
      },
      applied_at: app.created_at,
      updated_at: app.updated_at,
    };
  });
}

export async function getCandidateById(applicationId: string) {
  const userId = await requireUserId();
  // Malformed ids resolve to a plain not-found, same contract as a missing row.
  if (!uuidSchema.safeParse(applicationId).success) return null;
  const data = (await fetchCandidateById(applicationId, userId)) as ApplicationWithCandidate | null;
  if (!data) return null;

  const candidateRecord = data.candidates;
  const parsed = data.parsed_data as ParsedResumeData | null;

  // Generate signed URL for resume if path exists, and look up the
  // currently-active resume rubric version so the UI can flag scores
  // produced under a stale rubric.
  const [resumeSignedUrl, currentResumeRubricVersion, currentScreeningRubricVersion] = await Promise.all([
    data.resume_url ? getResumeSignedUrl(data.resume_url) : Promise.resolve(null),
    fetchActiveRubricVersion(data.campaign_id, "resume"),
    fetchActiveRubricVersion(data.campaign_id, "screening_q"),
  ]);

  return {
    id: data.id,
    campaign_id: data.campaign_id,
    name: `${candidateRecord.first_name} ${candidateRecord.last_name}`,
    email: candidateRecord.email,
    phone: candidateRecord.phone,
    current_title: parsed?.experience?.[0]?.title || null,
    current_company: parsed?.experience?.[0]?.company || null,
    stage: toCandidateStage(data.status),
    // Raw canonical pipeline state — drives the StageChanger, which offers
    // legal next-states from APPLICATION_STATE_TRANSITIONS. `stage` above is
    // the coarse label kept for other UI; the two are intentionally distinct.
    status: data.status as ApplicationState,
    awaiting_human_review: data.status === "screening_review_pending",
    screening_tier: data.screening_tier || null,
    scores: buildScoresArray(
      data,
      currentResumeRubricVersion,
      scoredScreeningResponse(data.screening_question_responses),
      currentScreeningRubricVersion,
    ),
    applied_at: data.created_at,
    resume_url: resumeSignedUrl || "",
    resume: {
      skills: parsed?.skills || [],
      experience_years: parsed?.experience?.length || 0,
      education: parsed?.education?.[0]?.institution || "Unknown",
    },
    parsed_data: parsed,
    linkedin_url: candidateRecord.linkedin_url,
    portfolio_url: candidateRecord.portfolio_url,
  };
}

export async function updateCandidateStage(
  applicationId: string,
  toState: string,
  rationale: string,
) {
  const userId = await requireUserId();
  uuidSchema.parse(applicationId);
  const validState = applicationStateSchema.parse(toState);
  const validRationale = stageChangeRationaleSchema.parse(rationale);

  // A recruiter may route an application, but may not hand-set a state that
  // asserts a candidate/AI artifact (e.g. screening_completed, screening_scored)
  // — those would fabricate pipeline state with no response or score behind it.
  assertRecruiterSettableTarget(validState);

  // Fetch campaign_id before updating so we can revalidate the right paths
  const campaignId = await fetchApplicationCampaignId(applicationId);

  await updateApplicationStage(applicationId, validState, validRationale);

  await sendTransitionNotification(applicationId, validState, userId);

  if (campaignId) {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/candidates/${applicationId}`);
  }
}

// ─── Resume Scoring ─────────────────────────────────────────────────────────
// Scoring and transition are intentionally split: the AI layer only produces
// evidence; the rule layer (src/lib/rules/resume-scoring.ts) reads that
// evidence and decides whether to transition. See CLAUDE.md → ATS State
// Machine Rules.

/**
 * AI layer — produces and persists resume-score evidence. Never transitions.
 * Returns the score + scoring config so the rule layer can decide; returns
 * null if the campaign has no screening criteria configured.
 */
async function scoreApplicationResume(
  applicationId: string,
  campaignId: string,
  candidateId: string,
  userId: string,
  parsedResume: ParsedResumeData | Record<string, unknown>,
): Promise<{ result: ResumeScoreResult; config: CampaignScoringConfig } | null> {
  const config = await fetchCampaignScoringConfig(campaignId, userId);
  if (!config || config.screening_criteria.length === 0) return null;

  const [evidence, rubricVersion] = await Promise.all([
    scoreResumeAgainstCriteria(
      parsedResume,
      config.screening_criteria,
      config.description,
    ),
    fetchActiveRubricVersion(campaignId, "resume"),
  ]);

  await saveResumeScore({
    applicationId,
    campaignId,
    candidateId,
    score: evidence.result.overall_score,
    tier: evidence.result.tier as Database["public"]["Enums"]["screening_tier_enum"],
    rationale: evidence.result.rationale,
    factors: evidence.result.factors,
    rubricVersion,
    audit: {
      model: evidence.model,
      promptVersion: evidence.promptVersion,
      rawOutput: evidence.rawOutput,
      inputSnapshot: {
        criteria_count: config.screening_criteria.length,
        criteria_labels: config.screening_criteria.map((c) => c.label),
        job_description_length: config.description.length,
      },
    },
  });

  return { result: evidence.result, config };
}

/**
 * Score every candidate in a campaign that has no resume score yet — the
 * automatic replacement for the retired manual "Score Resume" button. Run after
 * a campaign's criteria/rubric is saved (see `updateCampaign`) so candidates who
 * arrived before criteria existed, or before the latest rubric, get evaluated
 * without a manual click.
 *
 * No-ops when the campaign has no criteria or isn't Active (the freeze rule).
 * Best-effort per candidate: one candidate's failure is logged and never blocks
 * the rest — or the caller (the campaign save). Already-scored candidates are
 * left untouched (we never overwrite an existing score).
 */
export async function scoreUnscoredCampaignCandidates(
  campaignId: string,
  userId: string,
): Promise<void> {
  const config = await fetchCampaignScoringConfig(campaignId, userId);
  if (!config || config.screening_criteria.length === 0) return; // nothing to score against

  const status = await fetchCampaignStatus(campaignId, userId);
  if (!status || !isCampaignProcessingActive(status)) return; // freeze rule

  const applications = await fetchCandidatesByCampaignId(campaignId, userId);

  for (const app of applications) {
    if (app.resume_score != null) continue; // already scored — don't overwrite
    const parsedResume = app.parsed_data as ParsedResumeData | null;
    const candidateId = app.candidates?.id;
    if (!parsedResume || !candidateId) continue; // nothing to score against / orphan row

    try {
      const scored = await scoreApplicationResume(app.id, campaignId, candidateId, userId, parsedResume);
      if (scored) {
        const decision = evaluateResumeScoringOutcome(scored.result, scored.config);
        await advanceApplicationStatus(app.id, decision.toState as CandidateStageEnum, decision.rationale);
        await sendTransitionNotification(app.id, decision.toState, userId);
        await autoSendScreeningIfApproved(app.id, decision.toState);
      }
    } catch (err) {
      console.error(
        `scoreUnscoredCampaignCandidates: scoring ${app.id} failed (non-blocking):`,
        err,
      );
    }
  }
}

/**
 * Recruiter-triggered re-score of one application's resume — the action behind
 * the "Re-score" button shown when a score was produced under a stale rubric.
 *
 * Evidence only, by design: it persists a fresh score (every run is appended
 * to ai_audit_log, so nothing is lost) but NEVER transitions. The application
 * may be anywhere in the pipeline, and advancement stays with the flows that
 * own it — the HITL panel, the manual stage changer, or the scoring rule on
 * first evaluation. Re-running the decision rule here could re-decide an
 * in-flight application off a score the original transition never saw.
 */
export async function rescoreCandidateResume(
  applicationId: string,
): Promise<{ rescored: true }> {
  uuidSchema.parse(applicationId);
  const userId = await requireUserId();

  checkRateLimit(userId, {
    name: "resume-rescore",
    maxRequests: 15,
    windowMs: 5 * 60 * 1000,
  });

  const data = (await fetchCandidateById(applicationId, userId)) as ApplicationWithCandidate | null;
  if (!data) throw new Error("Application not found");

  assertResumeRescoreAllowed(data.status);

  // Re-scoring is processing, so the campaign freeze rule applies.
  await assertCampaignActiveById(data.campaign_id, userId);

  const parsedResume = data.parsed_data as ParsedResumeData | null;
  const candidateId = data.candidates?.id;
  if (!parsedResume || !candidateId) {
    throw new Error("This application has no parsed resume to score.");
  }

  const scored = await scoreApplicationResume(
    applicationId,
    data.campaign_id,
    candidateId,
    userId,
    parsedResume,
  );
  if (!scored) {
    throw new Error(
      "This campaign has no resume criteria configured. Set them up on the campaign page first.",
    );
  }

  revalidatePath(`/campaigns/${data.campaign_id}`);
  revalidatePath(`/campaigns/${data.campaign_id}/candidates/${applicationId}`);
  return { rescored: true };
}

// ─── HITL Screening Review ──────────────────────────────────────────────────
// When automation_mode = human_in_loop, the resume-scoring rule routes
// applications to `screening_review_pending` instead of approving/rejecting
// automatically. This action is the recruiter's decision point. It is a
// recruiter-actor transition, so a written rationale is mandatory.

export async function decideHitlReview(input: {
  applicationId: string;
  decision: "approve" | "reject";
  rationale: string;
}) {
  const userId = await requireUserId();

  // Validate shape, length, decision enum, and uuid format up-front.
  const parsed = hitlReviewDecisionSchema.parse(input);

  checkRateLimit(userId, { name: "hitl-review", maxRequests: 30, windowMs: 5 * 60 * 1000 });

  // Ownership check + preflight: only proceed if this application is actually
  // in `screening_review_pending`. Without this guard a recruiter could press
  // approve/reject on a stale page and try to drive an illegal transition.
  const data = (await fetchCandidateById(parsed.applicationId, userId)) as ApplicationWithCandidate | null;
  if (!data) throw new Error("Application not found");

  if (data.status !== "screening_review_pending") {
    throw new Error("Application is no longer awaiting review");
  }

  // Approving processes the candidate (advances + auto-sends screening), so it
  // freezes unless the campaign is Active. Rejecting is a stop, not processing,
  // and stays allowed so a recruiter can clear out a paused/closed campaign.
  if (parsed.decision === "approve") {
    await assertCampaignActiveById(data.campaign_id, userId);

    // Approval promises an immediate screening email (the modal says so). A
    // campaign with no questions configured can never fulfil that, and it's a
    // setup gap the recruiter can fix right now — so block BEFORE the
    // transition instead of approving into a parked state and warning after
    // the fact. Transient send failures (Gmail disconnected, delivery error)
    // are different: those still degrade gracefully below, because they
    // shouldn't undo a recorded human decision.
    const questions = await fetchScreeningQuestionsByCampaignId(data.campaign_id);
    if (questions.length === 0) {
      throw new Error(
        "This campaign has no screening questions configured. Set them up on the campaign page, then approve.",
      );
    }
  }

  const toState: ApplicationState =
    parsed.decision === "approve" ? "screening_approved" : "rejected";

  await transitionApplication({
    applicationId: parsed.applicationId,
    toState,
    actor: "recruiter",
    rationale: parsed.rationale,
  });

  await sendTransitionNotification(parsed.applicationId, toState, userId);

  // On approval, email the candidate their screening questions immediately so
  // the recruiter doesn't have to remember a separate "send" step. The send
  // re-checks ownership + eligibility and advances screening_approved →
  // screening_sent on success. Degrade gracefully: a transient send failure
  // (Gmail disconnected, delivery error) must NOT undo the approval — the
  // candidate stays approved and the recruiter can send manually. The returned
  // warning explains why no email went out. (Missing screening questions are
  // not a send failure — they're preflighted above, before the transition.)
  let screeningEmailSent = false;
  let screeningWarning: string | undefined;
  if (parsed.decision === "approve") {
    try {
      await sendScreeningQuestionsToCandidate(parsed.applicationId);
      screeningEmailSent = true;
    } catch (err) {
      screeningWarning =
        err instanceof Error
          ? err.message
          : "Approved, but the screening questions could not be sent automatically.";
    }
  }

  revalidatePath(`/campaigns/${data.campaign_id}`);
  revalidatePath(`/campaigns/${data.campaign_id}/candidates/${parsed.applicationId}`);

  return {
    success: true,
    decision: parsed.decision,
    screeningEmailSent,
    screeningWarning,
  };
}
