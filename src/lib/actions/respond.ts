"use server";

import { headers } from "next/headers";
import { z } from "zod/v4";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { screeningAnswerSubmissionSchema } from "@/lib/validations";
import {
  fetchApplicationForResponse,
  fetchApplicationCampaignId,
} from "@/lib/data/candidates";
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  saveCandidateAnswers,
  type ScreeningQuestionRow,
} from "@/lib/data/screening-questions";
import {
  assertResponseIsOpen,
  assertResponseNotResubmitted,
  validateRequiredAnswersPresent,
} from "@/lib/rules/screening-response";
import { transitionApplication } from "@/lib/data/transitions";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export interface VerifiedResponseContext {
  application_id: string;
  status: "pending" | "sent" | "responded" | "scored" | "expired";
  campaign_title: string;
  questions: ScreeningQuestionRow[];
  existing_answers: Record<string, string>;
  expires_at: Date;
}

/**
 * Called by the public /respond/[token] page to load the form.
 * Verifies the token, ensures the response row is still open, and
 * returns the questions + any in-progress answers.
 *
 * This does NOT write anything, so it's safe to call on every page load.
 * Throws with a user-facing message on any failure.
 */
export async function loadResponseContext(
  token: string
): Promise<VerifiedResponseContext> {
  const { application_id, expires_at } = verifyResponseToken(token);

  const app = await fetchApplicationForResponse(application_id);
  if (!app) {
    throw new Error(
      "We couldn't find this application. Please contact the hiring team."
    );
  }

  const response = await fetchScreeningResponseByApplicationId(application_id);
  if (!response) {
    throw new Error(
      "This link is no longer active. Please contact the hiring team for a new one."
    );
  }

  assertResponseIsOpen(response.status);

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id);

  const existing: Record<string, string> = {};
  for (const a of response.answers ?? []) {
    existing[a.question_id] = a.answer_text ?? "";
  }

  return {
    application_id,
    status: response.status,
    campaign_title: app.campaign_title,
    questions,
    existing_answers: existing,
    expires_at,
  };
}

/**
 * Public submit action called from the candidate form. Verifies the token,
 * rate-limits by IP, validates answers, and persists them with status
 * 'responded'. The recruiter's score action picks up from there.
 */
export async function submitScreeningAnswers(input: {
  token: string;
  answers: { question_id: string; answer_text: string }[];
}): Promise<{ ok: true }> {
  let parsed;
  try {
    parsed = screeningAnswerSubmissionSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues[0]?.message ?? "Invalid submission");
    }
    throw err;
  }

  const { application_id } = verifyResponseToken(parsed.token);

  // IP rate limit — prevents abuse from an actor who has scraped a token.
  const ip = await getClientIp();
  checkRateLimit(ip, {
    name: "screening-submit",
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
  });

  const existing = await fetchScreeningResponseByApplicationId(application_id);
  if (!existing) {
    throw new Error(
      "This link is no longer active. Please contact the hiring team for a new one."
    );
  }

  assertResponseNotResubmitted(existing.status);

  // Look up the application's campaign so we can reload the authoritative
  // question set (with is_required flags).
  const campaignId = await fetchApplicationCampaignId(application_id);
  if (!campaignId) {
    throw new Error("This application no longer exists.");
  }
  const questions = await fetchScreeningQuestionsByCampaignId(campaignId);
  if (questions.length === 0) {
    throw new Error("No screening questions are configured for this role.");
  }

  const questionById = new Map(questions.map((q) => [q.id, q]));

  // Reject answers that reference unknown question ids — someone tampering
  // with the form in devtools should not be able to plant fake ones.
  const answers = parsed.answers.map((a) => {
    const q = questionById.get(a.question_id);
    if (!q) {
      throw new Error("An answer was submitted for a question we don't recognise.");
    }
    return {
      question_id: a.question_id,
      prompt: q.prompt,
      answer_text: a.answer_text,
    };
  });

  validateRequiredAnswersPresent(questions, answers);

  await saveCandidateAnswers(application_id, answers);

  // Best-effort: the candidate's answers are durable; a transition failure
  // (illegal source state, RPC error) shouldn't surface as a submission
  // failure to the candidate. A recruiter sees the response and can advance
  // manually.
  try {
    await transitionApplication({
      applicationId: application_id,
      toState: "screening_completed",
      actor: "system",
      rationale: "Candidate submitted screening answers",
    });
  } catch (err) {
    console.error(
      `Failed to transition ${application_id} → screening_completed:`,
      err instanceof Error ? err.message : err,
    );
  }

  return { ok: true };
}
