"use server";

import { headers } from "next/headers";
import { z } from "zod/v4";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import {
  screeningAnswerSubmissionSchema,
  voiceScreeningSubmissionSchema,
} from "@/lib/validations";
import {
  fetchApplicationForResponse,
  fetchApplicationCampaignId,
} from "@/lib/data/candidates";
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  fetchScoringContextByApplicationId,
  saveCandidateAnswers,
  saveVoiceTranscript,
  markScreeningResponseExpired,
  type ScreeningQuestionRow,
  type VoiceTranscriptTurn,
} from "@/lib/data/screening-questions";
import { runScreeningScoring } from "./score-screening-response";
import {
  assertResponseIsOpen,
  assertResponseNotResubmitted,
  isResponseExpired,
  validateRequiredAnswersPresent,
  ScreeningResponseError,
} from "@/lib/rules/screening-response";
import {
  createRealtimeSession,
  buildScreeningInstructions,
  type RealtimeSession,
} from "@/lib/services/realtime";
import { transitionApplication } from "@/lib/data/transitions";

const VOICE_RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 10 * 60 * 1000,
} as const;

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

// ─── Voice Screening (#83) ──────────────────────────────────────────────────

/**
 * Best-effort transition. The candidate has already left (call ended, or page
 * unloaded), so a transition failure must never surface to them — it's logged
 * and the recruiter can advance the application manually.
 */
async function tryTransition(
  applicationId: string,
  toState: Parameters<typeof transitionApplication>[0]["toState"],
  rationale: string,
): Promise<void> {
  try {
    await transitionApplication({ applicationId, toState, actor: "system", rationale });
  } catch (err) {
    console.error(
      `Failed to transition ${applicationId} → ${toState}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Best-effort auto-scoring right after a completed voice call — so a recruiter
 * no longer has to click "Score answers". Runs in the candidate's token-verified
 * request, where there is no recruiter session, so it resolves the campaign
 * config + owner from the application alone. A failure must never surface to the
 * candidate (they've already left): the transcript is persisted and the response
 * stays `responded`, so a recruiter can still score manually. The advancement
 * decision stays rule-driven inside `runScreeningScoring` (Control > AI > Data).
 */
async function autoScoreScreening(applicationId: string): Promise<void> {
  try {
    const ctx = await fetchScoringContextByApplicationId(applicationId);
    if (!ctx?.description) {
      console.warn(
        `autoScoreScreening: skipping ${applicationId} — campaign has no job description to score against.`,
      );
      return;
    }
    await runScreeningScoring({
      applicationId,
      campaignId: ctx.campaign_id,
      candidateId: ctx.candidate_id,
      ownerUserId: ctx.owner_user_id,
      description: ctx.description,
      automation_mode: ctx.automation_mode,
      screening_threshold: ctx.screening_threshold,
    });
  } catch (err) {
    console.error(
      `autoScoreScreening failed for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Mint an ephemeral OpenAI Realtime session for a candidate to take their
 * voice screening on `/respond/[token]` (#83). The candidate-facing twin of
 * the recruiter-only `startScreeningPreviewSession`: gated on a verified
 * screening token (candidates have no account) and IP-rate-limited.
 *
 * Lazy expiry: if the deadline has passed, the response is expired and the
 * application transitioned to `screening_expired` rather than minting a call.
 */
export async function startCandidateVoiceScreening(
  token: string,
): Promise<RealtimeSession> {
  const { application_id } = verifyResponseToken(token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "voice-screening-start", ...VOICE_RATE_LIMIT });

  const app = await fetchApplicationForResponse(application_id);
  if (!app) {
    throw new ScreeningResponseError(
      "This link is no longer active. Please contact the hiring team for a new one.",
    );
  }

  const response = await fetchScreeningResponseByApplicationId(application_id);
  if (!response) {
    throw new ScreeningResponseError(
      "This link is no longer active. Please contact the hiring team for a new one.",
    );
  }

  if (
    isResponseExpired(
      response.expires_at ? new Date(response.expires_at) : null,
      new Date(),
    )
  ) {
    await expireScreeningResponse(application_id);
    throw new ScreeningResponseError(
      "This link has expired. Please contact the hiring team for a new one.",
    );
  }

  assertResponseIsOpen(response.status);

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id);
  if (questions.length === 0) {
    throw new ScreeningResponseError(
      "No screening questions are configured for this role.",
    );
  }

  const instructions = buildScreeningInstructions({
    jobTitle: app.campaign_title,
    questions: questions.map((q) => ({ prompt: q.prompt, is_required: q.is_required })),
  });

  return createRealtimeSession({ instructions });
}

/** Expire the response row and best-effort transition the application. */
async function expireScreeningResponse(applicationId: string): Promise<void> {
  await markScreeningResponseExpired(applicationId);
  await tryTransition(
    applicationId,
    "screening_expired",
    "Screening deadline passed before the candidate completed the voice call",
  );
}

/**
 * Persist a completed voice screening call (#83): store the captured
 * transcript and advance `screening_sent → screening_completed`. The
 * recruiter's scoring action (#84) reads the transcript from here.
 *
 * Token-gated + IP-rate-limited, mirroring `submitScreeningAnswers`. An empty
 * transcript is rejected by the schema — a no-transcript call is a capture
 * failure and goes through `reportVoiceScreeningFailure` instead.
 */
export async function submitVoiceScreening(input: {
  token: string;
  transcript: VoiceTranscriptTurn[];
}): Promise<{ ok: true }> {
  let parsed;
  try {
    parsed = voiceScreeningSubmissionSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues[0]?.message ?? "Invalid submission");
    }
    throw err;
  }

  const { application_id } = verifyResponseToken(parsed.token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "voice-screening-submit", ...VOICE_RATE_LIMIT });

  const existing = await fetchScreeningResponseByApplicationId(application_id);
  if (!existing) {
    throw new ScreeningResponseError(
      "This link is no longer active. Please contact the hiring team for a new one.",
    );
  }

  assertResponseNotResubmitted(existing.status);

  await saveVoiceTranscript(application_id, parsed.transcript);

  await tryTransition(
    application_id,
    "screening_completed",
    "Candidate completed the voice screening call",
  );

  // Score the call immediately — no recruiter click required. Best-effort and
  // awaited so the score lands before the candidate's "done" screen; failures
  // are logged, never surfaced (the recruiter can still score manually).
  await autoScoreScreening(application_id);

  return { ok: true };
}

/**
 * Explicit failure path for a voice call that ended without a usable
 * transcript (Realtime error, or capture produced nothing). Never silent:
 * `processing_failed` is legal only from `screening_completed`, so we record
 * the completion of the attempt first, then the failure — the transitions log
 * carries the full story. Best-effort, since the candidate has already left.
 */
export async function reportVoiceScreeningFailure(input: {
  token: string;
}): Promise<{ ok: true }> {
  const { application_id } = verifyResponseToken(input.token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "voice-screening-submit", ...VOICE_RATE_LIMIT });

  const existing = await fetchScreeningResponseByApplicationId(application_id);
  if (!existing) {
    throw new ScreeningResponseError(
      "This link is no longer active. Please contact the hiring team for a new one.",
    );
  }

  assertResponseNotResubmitted(existing.status);

  await tryTransition(application_id, "screening_completed", "Voice screening call ended");
  await tryTransition(
    application_id,
    "processing_failed",
    "Voice screening produced no usable transcript (capture/Realtime error)",
  );

  return { ok: true };
}
