"use server";

import { headers } from "next/headers";
import { z } from "zod/v4";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { screeningAnswerSubmissionSchema } from "@/lib/validations";
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
import { createClient } from "@/lib/supabase/server";

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

  // We use the anon client here; RLS policies require auth.uid() but we
  // need to read as an unauthenticated candidate. This works because the
  // Supabase URL + anon key aren't privileged — the security comes from
  // the signed token, not the DB key. For production, move this to a
  // service-role client so RLS can stay strict.
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Look up the application → campaign for title + owning campaign id.
  const { data: appRow, error: appErr } = await db
    .from("applications")
    .select("id, campaign_id, campaigns!inner(id, title)")
    .eq("id", application_id)
    .single();

  if (appErr || !appRow) {
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

  const questions = await fetchScreeningQuestionsByCampaignId(appRow.campaign_id);

  const existing: Record<string, string> = {};
  for (const a of response.answers ?? []) {
    existing[a.question_id] = a.answer_text ?? "";
  }

  return {
    application_id,
    status: response.status,
    campaign_title: appRow.campaigns.title,
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
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: appRow } = await db
    .from("applications")
    .select("campaign_id")
    .eq("id", application_id)
    .single();
  if (!appRow) {
    throw new Error("This application no longer exists.");
  }
  const questions = await fetchScreeningQuestionsByCampaignId(appRow.campaign_id);
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

  return { ok: true };
}
