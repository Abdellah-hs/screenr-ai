"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestOrigin } from "@/lib/http/origin";
import {
  uuidSchema,
  screeningQuestionsArraySchema,
} from "@/lib/validations";
import { generateQuestionsForRole } from "@/lib/services/screening-questions";
import {
  fetchCampaignScoringConfig,
  fetchScreeningRubricDimensions,
  verifyCampaignOwnership,
} from "@/lib/data/campaigns";
import { runScreeningScoring } from "@/lib/screening/score-response";
import type { gmail_v1 } from "googleapis/build/src/apis/gmail";
import { sendEmail } from "@/lib/services/email";
import { getRecruiterGmailClient } from "./gmail-sender";
import { buildScreeningQuestionsEmail } from "@/lib/services/email-templates/screening-questions";
import { signResponseToken } from "@/lib/auth/screening-token";
import { requireUserId } from "@/lib/auth/guards";
import type { ApplicationState } from "@/lib/constants";
import { transitionApplication } from "@/lib/data/transitions";
import { assertEligibleForScreeningSend } from "@/lib/rules/screening-response";
import { assertCampaignActiveById } from "./campaign-guards";
import {
  fetchScreeningQuestionsByCampaignId,
  replaceScreeningQuestions,
  upsertPendingScreeningResponse,
  fetchApplicationForScreeningSend,
  fetchScreeningResponseByApplicationId,
  type ScreeningQuestionRow,
  type ScreeningResponseRow,
} from "@/lib/data/screening-questions";

async function requireCampaignOwner(campaignId: string): Promise<string> {
  uuidSchema.parse(campaignId);
  const userId = await requireUserId();

  if (!(await verifyCampaignOwnership(campaignId, userId))) {
    throw new Error("Campaign not found or access denied");
  }
  return userId;
}

export async function getScreeningQuestions(
  campaignId: string
): Promise<ScreeningQuestionRow[]> {
  await requireCampaignOwner(campaignId);
  return fetchScreeningQuestionsByCampaignId(campaignId);
}

/**
 * AI-generate a fresh set of screening questions for a campaign. Does not persist.
 * The UI shows them in the editor so the recruiter can tweak before saving.
 */
export async function generateScreeningQuestions(
  campaignId: string
): Promise<{ prompt: string }[]> {
  const userId = await requireCampaignOwner(campaignId);

  // Reuse the AI generation bucket — same OpenAI quota concern applies.
  checkRateLimit(userId, {
    name: "ai-generate",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  const config = await fetchCampaignScoringConfig(campaignId, userId);
  if (!config) throw new Error("Campaign not found");
  if (!config.description || config.description.trim().length < 10) {
    throw new Error(
      "Add a job description to the campaign before generating screening questions."
    );
  }

  // The SCREENING rubric, not the resume one. `config.screening_criteria` is
  // built from the `resume` rubric — passing it here drafted questions against
  // what the CV was gated on rather than what the call will be graded on.
  const { dimensions } = await fetchScreeningRubricDimensions(campaignId);

  // No `count`: the set is sized from the rubric, so a dimension is never
  // left unprobed by an arbitrary fixed number of questions.
  return generateQuestionsForRole({
    jobDescription: config.description,
    rubricDimensions: dimensions,
  });
}

/**
 * Persist an edited set of screening questions for a campaign. Replaces the whole set.
 */
export async function saveScreeningQuestions(
  campaignId: string,
  questions: { id?: string; prompt: string }[]
): Promise<void> {
  await requireCampaignOwner(campaignId);

  const validated = screeningQuestionsArraySchema.parse(questions);

  await replaceScreeningQuestions(
    campaignId,
    validated.map((q) => ({ prompt: q.prompt }))
  );

  // The question set surfaces on every candidate detail page under this
  // campaign (screening thread, HITL approve gate), not just the campaign
  // page — revalidate the whole subtree so those pages don't keep serving
  // a cached "no questions configured" render.
  revalidatePath(`/campaigns/${campaignId}`, "layout");
}

// ─── Email Delivery ─────────────────────────────────────────────────────────

const RESPONSE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function buildAndSendOne(params: {
  gmail: gmail_v1.Gmail;
  applicationId: string;
  campaignTitle: string;
  candidateName: string;
  candidateEmail: string;
  questions: ScreeningQuestionRow[];
  origin: string;
}): Promise<void> {
  const {
    gmail,
    applicationId,
    campaignTitle,
    candidateName,
    candidateEmail,
    questions,
    origin,
  } = params;

  const expiresAt = new Date(Date.now() + RESPONSE_TTL_MS);

  // Seed the response row first — if the email send fails we still have
  // a tracked "sent" record the recruiter can retry from, and the candidate
  // will see a valid row when they click through.
  await upsertPendingScreeningResponse(
    applicationId,
    questions.map((q) => ({ question_id: q.id, prompt: q.prompt })),
    expiresAt
  );

  const token = signResponseToken(applicationId, RESPONSE_TTL_MS);
  const respondUrl = `${origin}/respond/${encodeURIComponent(token)}`;

  const { subject, html, text } = buildScreeningQuestionsEmail({
    candidateName,
    campaignTitle,
    respondUrl,
    expiresAt,
    questionCount: questions.length,
  });

  await sendEmail(gmail, {
    to: candidateEmail,
    subject,
    html,
    text,
  });
}

/**
 * Best-effort transition to `screening_sent` after a successful email send.
 * The email is already durable, so a failed transition (illegal source state,
 * RPC error) is logged rather than propagated — a recruiter can advance the
 * state manually. Throwing here would risk the recruiter retrying the send
 * and duplicating the candidate email.
 */
async function tryAdvanceToScreeningSent(applicationId: string): Promise<void> {
  try {
    await transitionApplication({
      applicationId,
      toState: "screening_sent",
      actor: "system",
      rationale: "Screening questions email delivered",
    });
  } catch (err) {
    console.error(
      `Failed to transition ${applicationId} → screening_sent:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Send screening questions to a single candidate. Creates the pending
 * response row, signs a token, and emails the candidate the link.
 */
export async function sendScreeningQuestionsToCandidate(
  applicationId: string
): Promise<{ sent: true }> {
  uuidSchema.parse(applicationId);

  const userId = await requireUserId();
  const app = await fetchApplicationForScreeningSend(applicationId, userId);
  if (!app) throw new Error("Application not found or access denied");

  // Freeze outbound unless the campaign is Active — no candidate emails go out
  // from a draft/paused/closed campaign.
  await assertCampaignActiveById(app.campaign_id, userId);

  // Gate the send on pipeline state. The bulk sender filters ineligible
  // candidates at the query level; this single-candidate path has no such
  // filter, so without this guard the email would go out to anyone — even
  // a candidate still in resume review or already rejected. Must run before
  // buildAndSendOne: the post-send transition can't un-send a delivered mail.
  assertEligibleForScreeningSend(app.status);

  checkRateLimit(userId, {
    name: "screening-send",
    maxRequests: 30,
    windowMs: 10 * 60 * 1000,
  });

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id);
  if (questions.length === 0) {
    throw new Error(
      "This campaign has no screening questions configured. Set them up first."
    );
  }

  const gmail = await getRecruiterGmailClient(userId);
  const origin = await getRequestOrigin();
  await buildAndSendOne({
    gmail,
    applicationId: app.application_id,
    campaignTitle: app.campaign_title,
    candidateName: app.candidate_name,
    candidateEmail: app.candidate_email,
    questions,
    origin,
  });

  await tryAdvanceToScreeningSent(app.application_id);

  revalidatePath(`/campaigns/${app.campaign_id}`);
  revalidatePath(`/campaigns/${app.campaign_id}/candidates/${applicationId}`);
  return { sent: true };
}

// ─── Per-candidate Reads & Scoring ──────────────────────────────────────────

export interface CandidateScreeningState {
  status: ApplicationState | null;
  questions: ScreeningQuestionRow[];
  response: ScreeningResponseRow | null;
}

/**
 * Bundled read for the candidate detail page: the application's pipeline
 * state, the campaign's question set, and the candidate's response row (if
 * any). `status` lets the UI disable the send button for candidates who
 * haven't reached screening — see `isEligibleForScreeningSend`.
 */
export async function getCandidateScreeningState(
  applicationId: string
): Promise<CandidateScreeningState> {
  uuidSchema.parse(applicationId);

  const userId = await requireUserId();
  const app = await fetchApplicationForScreeningSend(applicationId, userId);
  if (!app) throw new Error("Application not found or access denied");

  const [questions, response] = await Promise.all([
    fetchScreeningQuestionsByCampaignId(app.campaign_id),
    fetchScreeningResponseByApplicationId(applicationId),
  ]);

  return { status: app.status, questions, response };
}

/**
 * Score a candidate's screening answers with OpenAI. Must be a responded
 * (but not yet scored) row, otherwise throws. Writes overall + per-answer
 * scores back to the response row.
 */
export async function scoreScreeningAnswers(
  applicationId: string
): Promise<{ overall_score: number }> {
  uuidSchema.parse(applicationId);

  const userId = await requireUserId();
  const app = await fetchApplicationForScreeningSend(applicationId, userId);
  if (!app) throw new Error("Application not found or access denied");

  // Freeze scoring unless the campaign is Active.
  await assertCampaignActiveById(app.campaign_id, userId);

  checkRateLimit(userId, {
    name: "ai-generate",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  const [response, config] = await Promise.all([
    fetchScreeningResponseByApplicationId(applicationId),
    fetchCampaignScoringConfig(app.campaign_id, userId),
  ]);

  if (!response) throw new Error("No screening response to score");
  if (response.status === "scored") {
    throw new Error("These answers have already been scored");
  }
  if (response.status !== "responded") {
    throw new Error(
      "This candidate hasn't submitted answers yet. You can only score once they respond."
    );
  }
  if (!config?.description) {
    throw new Error("Campaign is missing a job description — can't score without context.");
  }

  // The scoring itself (AI evidence + rule-driven transitions) is shared with
  // the candidate-triggered voice auto-score — see `runScreeningScoring`.
  const result = await runScreeningScoring({
    applicationId,
    campaignId: app.campaign_id,
    candidateId: app.candidate_id,
    ownerUserId: userId,
    description: config.description,
    automation_mode: config.automation_mode,
    screening_threshold: config.screening_threshold,
  });

  // The action revalidates, not the pipeline: a recruiter triggered this and is
  // looking at these two pages right now. The candidate-side caller has nobody
  // watching and deliberately does not.
  revalidatePath(`/campaigns/${app.campaign_id}/candidates/${applicationId}`);
  revalidatePath(`/campaigns/${app.campaign_id}`);

  return result;
}
