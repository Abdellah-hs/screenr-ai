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
import { createAdminClient } from "@/lib/supabase/admin";
import { reprocessFailedApplication } from "@/lib/resume-ingest/reprocess";
import { isRecoverableProcessingFailure } from "@/lib/rules/processing-failure";
import type { IngestRejectionReason } from "@/lib/resume-ingest/ingest-resume";
import { resolveRestoreTarget } from "@/lib/rules/auto-archive";
import { transitionApplication } from "@/lib/data/transitions";
import {
  assertRecruiterSettableTarget,
  manualStageDisposition,
} from "@/lib/rules/manual-stage-change";
import { sendTransitionNotification } from "./transition-notifications";
import { sendScreeningQuestionsToCandidate } from "./screening-questions";
import { assertCampaignActiveById } from "./campaign-guards";

// Services
import type { ParsedResumeData } from "@/lib/services/openai";

// Data Access
import {
  fetchCandidatesByCampaignId,
  fetchCampaignPipelineRows,
  fetchCandidateById,
  updateApplicationStage,
  advanceApplicationStatus,
  getResumeSignedUrl,
  fetchApplicationCampaignId,
  fetchPreArchiveState,
  fetchStateBefore,
} from "@/lib/data/candidates";
import {
  fetchSlaTimersByCampaignId,
  fetchActiveRubricVersions,
  fetchCampaignStatus,
} from "@/lib/data/campaigns";
import {
  evaluateApplicationResume,
  loadCampaignScoringContext,
  type CampaignScoringContext,
  type ResumeEvaluationOutcome,
} from "@/lib/resume-ingest/score-resume";
import { readResumeEvaluation } from "@/lib/resume-scoring";
import { fetchScreeningQuestionsByCampaignId } from "@/lib/data/screening-questions";
import { isCampaignProcessingActive } from "@/lib/rules/campaign-status";
import { applicationSlaStatus } from "@/lib/rules/sla";
import {
  hasResumeScore,
  hasScreeningScore,
  summarisePipeline,
  type PipelineSummary,
} from "@/lib/candidates/pipeline-summary";
import { withInterviewScore } from "@/lib/candidates/detail-header";

// Rules
import {
  evaluateResumeScoringOutcome,
  assertResumeRescoreAllowed,
} from "@/lib/rules/resume-scoring";
import { toCandidateStage, pipelineDisplayScore } from "@/lib/constants";
import type {
  ApplicationState,
  CandidateListRow,
  CandidateListScore,
  CandidateScore,
  CampaignStatus,
  ScoreFactor,
  ScreeningTier,
  TalentPoolApplication,
  TalentPoolCandidate,
} from "@/lib/constants";
import { fetchTalentPoolRows } from "@/lib/data/talent-pool";
import type { Database } from "@/types/database.types";

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type ScreeningListScoreRow = Pick<
  Database["public"]["Tables"]["screening_question_responses"]["Row"],
  "overall_score" | "status"
>;
type ScreeningResponseScoreRow = Pick<
  Database["public"]["Tables"]["screening_question_responses"]["Row"],
  "overall_score" | "overall_rationale" | "scored_at" | "rubric_version" | "status"
>;
/**
 * The application shape the candidates LIST selects — the wide row minus the
 * columns nothing in the table renders. Kept beside `ApplicationWithCandidate`
 * so the two stay visibly different: this one has no `resume_evaluation` and no
 * `score_factors`, because the query no longer asks for them.
 */
type CandidateListApplication = Pick<
  ApplicationRow,
  | "id"
  | "campaign_id"
  | "status"
  | "created_at"
  | "updated_at"
  | "parsed_data"
  | "resume_score"
  | "screening_tier"
  | "scored_at"
> & {
  candidates: Pick<CandidateRow, "id" | "first_name" | "last_name" | "email">;
  screening_question_responses:
    | ScreeningListScoreRow
    | ScreeningListScoreRow[]
    | null;
};

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
  row: Pick<ApplicationRow, "resume_score" | "screening_tier" | "score_rationale" | "score_factors" | "resume_evaluation" | "scored_at" | "created_at" | "rubric_version">,
  currentResumeRubricVersion: number | null,
  screeningResponse: ScreeningResponseScoreRow | null,
  currentScreeningRubricVersion: number | null,
): CandidateScore[] {
  const scores: CandidateScore[] = [];

  if (hasResumeScore(row)) {
    scores.push({
      stage: "resume",
      overall: row.resume_score != null ? Number(row.resume_score) : null,
      tier: (row.screening_tier as ScreeningTier | null) || undefined,
      ai_summary: row.score_rationale || "Scored by AI",
      factors: (row.score_factors as ScoreFactor[] | null) || [],
      evaluation: readResumeEvaluation(row.resume_evaluation),
      scored_at: row.scored_at || row.created_at,
      rubric_version: row.rubric_version,
      current_rubric_version: currentResumeRubricVersion,
    });
  }

  if (hasScreeningScore(screeningResponse)) {
    scores.push({
      stage: "screening",
      overall: Number(screeningResponse.overall_score),
      ai_summary: screeningResponse.overall_rationale || "Scored by AI",
      factors: [],
      evaluation: null,
      scored_at: screeningResponse.scored_at || row.created_at,
      rubric_version: screeningResponse.rubric_version,
      current_rubric_version: currentScreeningRubricVersion,
    });
  }

  return scores;
}

/**
 * The same two stage scores as `buildScoresArray`, carrying only what a list
 * cell draws. It shares the `hasResumeScore` / `hasScreeningScore` predicates
 * with the campaign board's summary and with `buildScoresArray` above, so no
 * two places that answer "has this been scored" can drift apart.
 */
function buildListScores(
  row: Pick<ApplicationRow, "resume_score" | "screening_tier" | "scored_at">,
  screeningResponse: ScreeningListScoreRow | null,
): CandidateListScore[] {
  const scores: CandidateListScore[] = [];

  if (hasResumeScore(row)) {
    scores.push({
      stage: "resume",
      overall: row.resume_score != null ? Number(row.resume_score) : null,
      tier: (row.screening_tier as ScreeningTier | null) || undefined,
    });
  }

  if (hasScreeningScore(screeningResponse)) {
    scores.push({
      stage: "screening",
      overall: Number(screeningResponse.overall_score),
    });
  }

  return scores;
}

/**
 * The scored screening response for an application, if any. Tolerates the embed
 * arriving as a single object (the one-to-one case PostgREST actually returns)
 * or an array, and only counts a response that has reached the `scored` status.
 */
function scoredScreeningResponse<T extends { status: string | null }>(
  responses: T | T[] | null,
): T | null {
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

/**
 * The campaign board's pipeline counts, without loading the candidates.
 *
 * The detail page used to call `getCandidatesByCampaignId` and reduce the
 * result to six numbers, which meant fetching every applicant's parsed CV and
 * full resume evaluation to count how many were in each stage. This asks the
 * database for the fields those numbers are made of and nothing else.
 *
 * It deliberately does NOT reuse the candidates list: the two want different
 * columns, and widening one query to serve both is how the page ended up
 * paying for evidence it never rendered.
 */
export async function getCampaignPipelineSummary(
  campaignId: string,
): Promise<PipelineSummary> {
  uuidSchema.parse(campaignId);
  const userId = await requireUserId();

  // One query for both versions: they are two rows of one table, keyed on the
  // same campaign, and this page is opened constantly.
  const [rows, rubricVersions, slaTimers] = await Promise.all([
    fetchCampaignPipelineRows(campaignId, userId),
    fetchActiveRubricVersions(campaignId, ["resume", "screening_q"]),
    fetchSlaTimersByCampaignId(campaignId),
  ]);
  const resumeRubricVersion = rubricVersions.resume ?? null;
  const screeningRubricVersion = rubricVersions.screening_q ?? null;

  return summarisePipeline(
    (rows ?? []).map((row) => ({
      status: row.status as ApplicationState,
      created_at: row.created_at,
      updated_at: row.updated_at,
      scored_at: row.scored_at,
      resume_score: row.resume_score != null ? Number(row.resume_score) : null,
      rubric_version: row.rubric_version,
      screening: firstScreeningRow(row.screening_question_responses),
    })),
    {
      slaTimers,
      resumeRubricVersion,
      screeningRubricVersion,
      // One clock reading for the whole board, so two applications that entered
      // a stage at the same moment cannot disagree about being overdue.
      now: new Date(),
    },
  );
}

/**
 * `screening_question_responses` has a UNIQUE(application_id), so PostgREST
 * returns a single object for this one-to-one embed — but the shape is not
 * guaranteed by the type, so both are tolerated, exactly as
 * `scoredScreeningResponse` does for the list.
 */
function firstScreeningRow<T>(embed: T | T[] | null): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

export async function getCandidatesByCampaignId(
  campaignId: string,
): Promise<CandidateListRow[]> {
  uuidSchema.parse(campaignId);
  const userId = await requireUserId();
  const [data, slaTimers] = await Promise.all([
    fetchCandidatesByCampaignId(campaignId, userId),
    fetchSlaTimersByCampaignId(campaignId),
  ]);
  if (!data) return [];

  // One clock reading for the whole list, so two rows that entered a stage at
  // the same moment can never disagree about whether they are overdue.
  const now = new Date();

  return (data as CandidateListApplication[]).map((app) => {
    const parsed = app.parsed_data as ParsedResumeData | null;
    const stage = toCandidateStage(app.status);
    return {
      id: app.id,
      campaign_id: app.campaign_id,
      name: `${app.candidates.first_name} ${app.candidates.last_name}`,
      email: app.candidates.email,
      current_title: parsed?.experience?.[0]?.title || null,
      current_company: parsed?.experience?.[0]?.company || null,
      stage,
      status: app.status as ApplicationState,
      awaiting_human_review: app.status === "screening_review_pending",
      is_archived: app.status === "archived",
      // Terminal buckets (including archived, which files under `rejected`)
      // resolve to null inside the rule — nobody is waiting on them, so a
      // badge there would have no action behind it.
      sla: applicationSlaStatus(stage, app.updated_at, slaTimers, now),
      scores: buildListScores(
        app,
        scoredScreeningResponse(app.screening_question_responses),
      ),
      applied_at: app.created_at,
      updated_at: app.updated_at,
    };
  });
}

/**
 * The Talent Pool: every candidate the recruiter owns (via their campaigns),
 * grouped by person, each carrying their full application history so removing a
 * campaign never hides the person — the removed campaign is just flagged on its
 * history entry. Reuses the same stage/score derivation as the per-campaign
 * table so a person's numbers read identically in both places.
 */
export async function getTalentPool(): Promise<TalentPoolCandidate[]> {
  const userId = await requireUserId();
  const rows = await fetchTalentPoolRows(userId);

  const byCandidate = new Map<string, TalentPoolCandidate>();

  for (const row of rows) {
    const stage = toCandidateStage(row.status);
    // Rubric versions are only needed for the stale-score badge, which the
    // Talent Pool doesn't show — pass null and take the stage-appropriate score.
    // `buildScoresArray` emits only `resume` and `screening` — the interview's
    // score lives on its session. Without folding it in, everyone sitting at
    // the interview stage showed a blank score here while the candidate detail
    // page displayed one, from the same data.
    const scores = withInterviewScore(
      buildScoresArray(
        row,
        null,
        scoredScreeningResponse(row.screening_question_responses),
        null,
      ),
      row.interview_sessions?.scores ?? null,
    );
    const display = pipelineDisplayScore({ stage, scores });

    const application: TalentPoolApplication = {
      applicationId: row.id,
      campaignId: row.campaign_id,
      campaignTitle: row.campaigns.title,
      campaignStatus: row.campaigns.status as CampaignStatus,
      campaignRemoved: row.campaigns.deleted_at != null,
      stage,
      score: display
        ? { overall: display.overall, stage: display.stage, tier: display.tier ?? null }
        : null,
      appliedAt: row.created_at,
    };

    const cand = row.candidates;
    const existing = byCandidate.get(cand.id);
    if (existing) {
      existing.applications.push(application);
      if (application.appliedAt > existing.latestActivityAt) {
        existing.latestActivityAt = application.appliedAt;
      }
    } else {
      byCandidate.set(cand.id, {
        id: cand.id,
        name: `${cand.first_name} ${cand.last_name}`.trim() || cand.email,
        email: cand.email,
        phone: cand.phone,
        location: cand.location,
        applications: [application],
        latestActivityAt: application.appliedAt,
      });
    }
  }

  const people = Array.from(byCandidate.values());
  // Each person's history newest-first; people ordered by most-recent activity.
  for (const person of people) {
    person.applications.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  }
  people.sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt));
  return people;
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
  const [resumeSignedUrl, rubricVersions] = await Promise.all([
    data.resume_url ? getResumeSignedUrl(data.resume_url) : Promise.resolve(null),
    fetchActiveRubricVersions(data.campaign_id, ["resume", "screening_q"]),
  ]);
  const currentResumeRubricVersion = rubricVersions.resume ?? null;
  const currentScreeningRubricVersion = rubricVersions.screening_q ?? null;

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
    // The candidate row's own copy of the contact block, which the parse was
    // persisted into at ingest. It is the fallback for a CV whose `parsed_data`
    // predates a field — every one of these is rendered as `parsed ?? this`, so
    // omitting `location` (as this did) made it the only contact fact on the
    // page with no fallback, and an old parse reported it as missing.
    location: candidateRecord.location,
    linkedin_url: candidateRecord.linkedin_url,
    github_url: candidateRecord.github_url,
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

  await updateApplicationStage(
    applicationId,
    validState,
    validRationale,
    manualStageDisposition(validState, validRationale),
  );

  await sendTransitionNotification(applicationId, validState, userId);

  if (campaignId) {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/candidates/${applicationId}`);
  }
}

/**
 * Bring an archived candidate back into the pipeline (PRD 3.12.4).
 *
 * Restores the state the application was in *immediately before* it was
 * archived, read back off the immutable transitions log rather than from a
 * `previous_status` column — the log already records the fact, and a second copy
 * could disagree with it.
 *
 * The target is validated by `resolveRestoreTarget`, so an archive whose origin
 * is missing or is not a legal exit from `archived` is refused rather than
 * guessed at. Putting a candidate back into a stage they never reached would be
 * worse than leaving them archived, and the transitions log would show it as
 * though they had been there.
 *
 * Logged as a recruiter action with a mandatory written rationale: un-archiving
 * reverses an automatic decision, and that is exactly the case CLAUDE.md's
 * manual-override rule exists for.
 */
export async function unarchiveApplication(
  applicationId: string,
  rationale: string,
) {
  await requireUserId();
  uuidSchema.parse(applicationId);
  const validRationale = stageChangeRationaleSchema.parse(rationale);

  const fromState = await fetchPreArchiveState(applicationId);
  const target = resolveRestoreTarget(fromState);
  if (!target) {
    throw new Error(
      "Can't restore this application — no archive step is recorded for it, so there is no state to return it to.",
    );
  }

  const campaignId = await fetchApplicationCampaignId(applicationId);

  await updateApplicationStage(
    applicationId,
    target,
    `Un-archived: ${validRationale}`,
  );

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
 * Evidence layer — extracts, verifies and deterministically scores one
 * application's resume, then persists it. Never transitions.
 *
 * A thin wrapper over the shared pipeline so this action and the ingest
 * pipeline evaluate a CV identically; the rule layer decides what happens next
 * from the result it returns. Null means the campaign has no resume criteria.
 */
async function scoreApplicationResume(
  applicationId: string,
  campaignId: string,
  candidateId: string,
  userId: string,
  parsedResume: ParsedResumeData | Record<string, unknown>,
  source: string,
  /** Hoisted by a caller scoring a whole campaign; fetched per call otherwise. */
  campaignContext?: CampaignScoringContext,
): Promise<ResumeEvaluationOutcome | null> {
  return evaluateApplicationResume({
    applicationId,
    campaignId,
    candidateId,
    ownerUserId: userId,
    parsedResume: parsedResume as Record<string, unknown>,
    source,
    campaignContext,
  });
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
  const status = await fetchCampaignStatus(campaignId, userId);
  if (!status || !isCampaignProcessingActive(status)) return; // freeze rule

  const applications = await fetchCandidatesByCampaignId(campaignId, userId);

  // The campaign's criteria, rubric and pass mark are the same for every row
  // here, and loading them costs four queries. Fetched per candidate, a
  // campaign that accumulated a hundred applicants before its rubric existed —
  // exactly what the new in-place "Edit rubric" button produces — paid four
  // hundred redundant round-trips in one action.
  const campaignContext = await loadCampaignScoringContext(campaignId, userId);
  if (!campaignContext) return; // no active resume criteria — nothing to score against

  for (const app of applications) {
    // `scored_at`, not `resume_score`: an ineligible candidate has no ranking
    // score, so a null score no longer means "never evaluated".
    if (app.scored_at != null) continue; // already scored — don't overwrite
    const parsedResume = app.parsed_data as ParsedResumeData | null;
    const candidateId = app.candidates?.id;
    if (!parsedResume || !candidateId) continue; // nothing to score against / orphan row

    try {
      const scored = await scoreApplicationResume(
        app.id,
        campaignId,
        candidateId,
        userId,
        parsedResume,
        "campaign_scoring_sweep",
        campaignContext,
      );
      if (scored) {
        const decision = evaluateResumeScoringOutcome(scored.result, scored.config);
        await advanceApplicationStatus(
          app.id,
          decision.toState as CandidateStageEnum,
          decision.rationale,
          decision.disposition,
        );
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
    "rescore",
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

// ─── Recovering a failed ingest ─────────────────────────────────────────────

/**
 * Read a candidate's CV again after our pipeline failed on it.
 *
 * `processing_failed` on a fresh application means Marker timed out, or a
 * model was down, while a real person's CV sat there unread. It is the only
 * failure state that is ours rather than theirs, so it is the only one with a
 * way out other than archiving — and this is that way out.
 *
 * The guard is `isRecoverableProcessingFailure`, not the state alone. There is
 * nothing to recover on an application that processed fine, and re-reading a CV
 * underneath a candidate who has since been screened would overwrite the parse
 * their score was computed against — and pull them back to `new`.
 *
 * The pipeline runs on the ADMIN client, after `fetchCandidateById` has proved
 * ownership under RLS — the same verify-then-act split the apply path uses. It
 * writes to `ai_audit_log` and to the candidate row, neither of which a
 * recruiter's own client is meant to be reaching directly.
 */
export async function retryResumeProcessing(
  applicationId: string,
): Promise<{ reprocessed: true }> {
  uuidSchema.parse(applicationId);
  const userId = await requireUserId();

  // Every attempt is a Marker conversion plus an OpenAI call, both of which
  // cost money per document — and the button is most tempting exactly when a
  // provider is down and it keeps failing.
  checkRateLimit(userId, {
    name: "resume-reprocess",
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
  });

  const data = (await fetchCandidateById(applicationId, userId)) as ApplicationWithCandidate | null;
  if (!data) throw new Error("Application not found");

  // The state alone does not say WHICH step failed. A screening or interview
  // score that could not be computed lands here too, and re-reading that
  // candidate's CV would repair nothing while pulling them back to `new` —
  // discarding a screening they actually sat. The rule allows the ingest
  // failure and nothing else.
  const failedFrom = await fetchStateBefore(applicationId, "processing_failed");
  if (
    !isRecoverableProcessingFailure({
      status: data.status as ApplicationState,
      failedFrom: failedFrom as ApplicationState | null,
    })
  ) {
    throw new Error(
      "There's no failed CV to re-read on this application. If a score failed to compute at a later stage, re-score that stage instead.",
    );
  }

  // Re-reading a CV is processing, so the campaign freeze rule applies.
  await assertCampaignActiveById(data.campaign_id, userId);

  const candidate = data.candidates;
  if (!candidate?.id || !candidate.email) {
    throw new Error("This application has no candidate record to attach a CV to.");
  }
  if (!data.resume_url) {
    throw new Error("This application has no stored CV to process.");
  }

  const result = await reprocessFailedApplication({
    db: createAdminClient(),
    applicationId,
    campaignId: data.campaign_id,
    candidateId: candidate.id,
    ownerUserId: userId,
    resumeUrl: data.resume_url,
    applicant: {
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      email: candidate.email,
      linkedin_url: candidate.linkedin_url,
      portfolio_url: candidate.portfolio_url,
    },
    candidateContact: {
      phone: candidate.phone,
      location: candidate.location,
      linkedin_url: candidate.linkedin_url,
      github_url: candidate.github_url,
      portfolio_url: candidate.portfolio_url,
    },
  });

  // A verdict about the document, not about our uptime. The application stays
  // in `processing_failed` — the recruiter now knows why, which they could not
  // before, and the candidate has not been auto-rejected on a second reading
  // of a file a person can simply open.
  if (result.outcome === "rejected") {
    throw new Error(REPROCESS_REJECTION_MESSAGE[result.reason]);
  }

  revalidatePath(`/campaigns/${data.campaign_id}`);
  revalidatePath(`/campaigns/${data.campaign_id}/candidates/${applicationId}`);
  return { reprocessed: true };
}

/** Recruiter-facing, and each one names what to do next. */
const REPROCESS_REJECTION_MESSAGE: Record<IngestRejectionReason, string> = {
  unreadable:
    "The extractor read this file and couldn't convert it — it's the document, not a timeout. Open the CV to check it, and ask the candidate to re-send it if it's corrupt.",
  not_a_cv:
    "This document doesn't read as a CV. Open it to check what was uploaded before doing anything with this application.",
  no_email:
    "No email address could be read from this CV. The candidate's application details still have one — use those to reach them.",
};

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
    // A HITL rejection is by definition a human overruling the automated
    // route — the resume rule sent this application to review rather than
    // rejecting it, and the recruiter is closing it anyway.
    disposition:
      parsed.decision === "reject"
        ? { code: "OVERRIDE_REJECTED", description: parsed.rationale }
        : undefined,
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
