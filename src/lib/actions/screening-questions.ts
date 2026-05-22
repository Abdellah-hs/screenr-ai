"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  uuidSchema,
  screeningQuestionsArraySchema,
} from "@/lib/validations";
import {
  generateQuestionsForRole,
  scoreAnswers,
} from "@/lib/services/screening-questions";
import { fetchCampaignScoringConfig, fetchActiveRubricVersion, verifyCampaignOwnership } from "@/lib/data/campaigns";
import { sendEmail } from "@/lib/services/email";
import { buildScreeningQuestionsEmail } from "@/lib/services/email-templates/screening-questions";
import { signResponseToken } from "@/lib/auth/screening-token";
import { requireUserId } from "@/lib/auth/guards";
import type { ApplicationState } from "@/lib/constants";
import { transitionApplication } from "@/lib/data/transitions";
import {
  assertEligibleForScreeningSend,
  evaluateScreeningScoringOutcome,
} from "@/lib/rules/screening-response";
import {
  fetchScreeningQuestionsByCampaignId,
  replaceScreeningQuestions,
  upsertPendingScreeningResponse,
  fetchApplicationForScreeningSend,
  fetchApplicationsReadyForScreeningSend,
  fetchScreeningResponseByApplicationId,
  saveAnswerScores,
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
): Promise<{ prompt: string; is_required: boolean }[]> {
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

  return generateQuestionsForRole({
    jobDescription: config.description,
    screeningCriteria: config.screening_criteria,
    count: 5,
  });
}

/**
 * Persist an edited set of screening questions for a campaign. Replaces the whole set.
 */
export async function saveScreeningQuestions(
  campaignId: string,
  questions: { id?: string; prompt: string; is_required: boolean }[]
): Promise<void> {
  await requireCampaignOwner(campaignId);

  const validated = screeningQuestionsArraySchema.parse(questions);

  await replaceScreeningQuestions(
    campaignId,
    validated.map((q) => ({ prompt: q.prompt, is_required: q.is_required }))
  );

  revalidatePath(`/campaigns/${campaignId}`);
}

// ─── Email Delivery ─────────────────────────────────────────────────────────

const RESPONSE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function buildAndSendOne(params: {
  applicationId: string;
  campaignTitle: string;
  candidateName: string;
  candidateEmail: string;
  questions: ScreeningQuestionRow[];
  origin: string;
}): Promise<void> {
  const {
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

  await sendEmail({
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

async function getOrigin(): Promise<string> {
  const h = await headers();
  const forwardedProto = h.get("x-forwarded-proto");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = forwardedProto ?? (host?.startsWith("localhost") ? "http" : "https");
  if (!host) throw new Error("Could not determine request origin");
  return `${proto}://${host}`;
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

  const origin = await getOrigin();
  await buildAndSendOne({
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

  checkRateLimit(userId, {
    name: "ai-generate",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  const [response, questions, config] = await Promise.all([
    fetchScreeningResponseByApplicationId(applicationId),
    fetchScreeningQuestionsByCampaignId(app.campaign_id),
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

  const answerInputs = (response.answers ?? []).map((a) => ({
    question_id: a.question_id,
    answer_text: a.answer_text ?? "",
  }));

  const [evidence, rubricVersion] = await Promise.all([
    scoreAnswers({
      jobDescription: config.description,
      questions: questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        is_required: q.is_required,
      })),
      answers: answerInputs,
    }),
    fetchActiveRubricVersion(app.campaign_id, "screening_q"),
  ]);

  await saveAnswerScores({
    applicationId,
    campaignId: app.campaign_id,
    candidateId: app.candidate_id,
    overall: { score: evidence.result.overall_score, rationale: evidence.result.overall_rationale },
    perAnswer: evidence.result.answers,
    rubricVersion,
    audit: {
      model: evidence.model,
      promptVersion: evidence.promptVersion,
      rawOutput: evidence.rawOutput,
      inputSnapshot: {
        question_count: questions.length,
        question_ids: questions.map((q) => q.id),
        answered_count: answerInputs.filter((a) => a.answer_text.trim().length > 0).length,
        job_description_length: config.description.length,
      },
    },
  });

  // Rule layer decides the chain of transitions from the persisted score
  // evidence + campaign config. HITL stops at screening_scored; auto-mode
  // chains through to interview_scheduling (pass) or rejected (fail).
  // Best-effort: scores are durable; if a transition fails we stop the
  // chain (subsequent steps would be illegal from a stuck state) and let
  // the recruiter advance manually.
  const decisions = evaluateScreeningScoringOutcome(
    { overall_score: evidence.result.overall_score },
    {
      automation_mode: config.automation_mode,
      screening_threshold: config.screening_threshold,
    },
  );

  for (const decision of decisions) {
    try {
      await transitionApplication({
        applicationId,
        toState: decision.toState,
        actor: "system",
        rationale: decision.rationale,
      });
    } catch (err) {
      console.error(
        `Failed to transition ${applicationId} → ${decision.toState}:`,
        err instanceof Error ? err.message : err,
      );
      break;
    }
  }

  revalidatePath(`/campaigns/${app.campaign_id}/candidates/${applicationId}`);
  revalidatePath(`/campaigns/${app.campaign_id}`);

  return { overall_score: evidence.result.overall_score };
}

/**
 * Send screening questions to every resume-scored candidate in a campaign
 * that's still in an early stage. Best-effort — errors are collected but
 * don't stop the rest of the batch.
 */
export async function sendScreeningQuestionsBulk(
  campaignId: string
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const userId = await requireCampaignOwner(campaignId);

  checkRateLimit(userId, {
    name: "screening-send-bulk",
    maxRequests: 5,
    windowMs: 10 * 60 * 1000,
  });

  const [questions, applications] = await Promise.all([
    fetchScreeningQuestionsByCampaignId(campaignId),
    fetchApplicationsReadyForScreeningSend(campaignId, userId),
  ]);

  if (questions.length === 0) {
    throw new Error(
      "This campaign has no screening questions configured. Set them up first."
    );
  }
  if (applications.length === 0) {
    return { sent: 0, failed: 0, errors: ["No candidates are ready to receive screening questions."] };
  }

  const origin = await getOrigin();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const app of applications) {
    try {
      await buildAndSendOne({
        applicationId: app.application_id,
        campaignTitle: app.campaign_title,
        candidateName: app.candidate_name,
        candidateEmail: app.candidate_email,
        questions,
        origin,
      });
      await tryAdvanceToScreeningSent(app.application_id);
      sent++;
    } catch (err) {
      failed++;
      errors.push(
        `${app.candidate_email}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { sent, failed, errors };
}
