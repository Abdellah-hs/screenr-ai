"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  uuidSchema,
  screeningQuestionsArraySchema,
} from "@/lib/validations";
import { generateQuestionsForRole } from "@/lib/services/screening-questions";
import { fetchCampaignScoringConfig } from "@/lib/data/campaigns";
import { sendEmail } from "@/lib/services/email";
import { buildScreeningQuestionsEmail } from "@/lib/services/email-templates/screening-questions";
import { signResponseToken } from "@/lib/auth/screening-token";
import {
  fetchScreeningQuestionsByCampaignId,
  replaceScreeningQuestions,
  upsertPendingScreeningResponse,
  fetchApplicationForScreeningSend,
  fetchApplicationsReadyForScreeningSend,
  type ScreeningQuestionRow,
} from "@/lib/data/screening-questions";

async function requireCampaignOwner(campaignId: string) {
  uuidSchema.parse(campaignId);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();

  if (!campaign) throw new Error("Campaign not found or access denied");
  return user;
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
  const user = await requireCampaignOwner(campaignId);

  // Reuse the AI generation bucket — same OpenAI quota concern applies.
  checkRateLimit(user.id, {
    name: "ai-generate",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  });

  const config = await fetchCampaignScoringConfig(campaignId);
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

  const app = await fetchApplicationForScreeningSend(applicationId);
  if (!app) throw new Error("Application not found or access denied");
  await requireCampaignOwner(app.campaign_id);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  checkRateLimit(user.id, {
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

  revalidatePath(`/campaigns/${app.campaign_id}`);
  revalidatePath(`/campaigns/${app.campaign_id}/candidates/${applicationId}`);
  return { sent: true };
}

/**
 * Send screening questions to every resume-scored candidate in a campaign
 * that's still in an early stage. Best-effort — errors are collected but
 * don't stop the rest of the batch.
 */
export async function sendScreeningQuestionsBulk(
  campaignId: string
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const user = await requireCampaignOwner(campaignId);

  checkRateLimit(user.id, {
    name: "screening-send-bulk",
    maxRequests: 5,
    windowMs: 10 * 60 * 1000,
  });

  const [questions, applications] = await Promise.all([
    fetchScreeningQuestionsByCampaignId(campaignId),
    fetchApplicationsReadyForScreeningSend(campaignId),
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
