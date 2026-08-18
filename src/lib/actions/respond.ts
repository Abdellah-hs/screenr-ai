"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod/v4";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { screeningAnswerSubmissionSchema, proctoringEventsSchema } from "@/lib/validations";
import { fetchApplicationForResponse } from "@/lib/data/candidates";
import { isCampaignProcessingActive } from "@/lib/rules/campaign-status";
import type { CampaignStatus } from "@/lib/constants";
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningResponseByApplicationId,
  fetchScoringContextByApplicationId,
  saveCandidateAnswers,
  saveVoiceTranscript,
  markScreeningResponseExpired,
  type ScreeningQuestionRow,
  type VoiceTranscriptTurn,
  saveScreeningProctoringReport,
} from "@/lib/data/screening-questions";
import { runScreeningScoring } from "./score-screening-response";
import {
  assertResponseIsOpen,
  assertResponseNotResubmitted,
  isResponseExpired,
  validateRequiredAnswersPresent,
  ScreeningResponseError,
} from "@/lib/rules/screening-response";
import { buildScreeningInstructions } from "@/lib/services/realtime";
import {
  createScreeningRoomGrant,
  type ScreeningRoomGrant,
} from "@/lib/services/livekit";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";
import { summarizeProctoring } from "@/lib/proctoring/incidents";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";

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

// Candidate-facing message for a screening whose campaign isn't Active. Neutral
// by design — it must not leak the internal status word or any ranking (PRD
// candidate-facing constraints).
const SCREENING_ON_HOLD_MESSAGE =
  "This screening is currently on hold. Please check back later or contact the hiring team.";

/**
 * Freeze the candidate screening flow unless the owning campaign is Active —
 * the candidate-side mirror of `assertCampaignActiveById`. A paused/closed/draft
 * campaign must not let a candidate start, submit, or auto-score a screening,
 * even via a link that went out while it was Active.
 */
function assertCampaignAcceptingResponses(status: CampaignStatus): void {
  if (!isCampaignProcessingActive(status)) {
    throw new ScreeningResponseError(SCREENING_ON_HOLD_MESSAGE);
  }
}

/**
 * The authorization boundary for every action in this module (#162).
 *
 * Candidates have no Screenr account, so there is no session behind these
 * requests — and every table the screening flow touches (`applications`,
 * `campaigns`, `screening_questions`, `screening_question_responses`) is
 * owner-only RLS scoped on `campaigns.user_id = auth.uid()`. Read through the
 * cookie client as an anonymous visitor and the policies match nothing: the
 * queries succeed and return empty, so a perfectly valid link surfaces as
 * "we couldn't find this application".
 *
 * So the signed token IS the authorization, and the service-role client is what
 * acts on it — the same boundary `src/lib/actions/interview.ts` already draws.
 * Two rules keep that honest:
 *
 *   1. `verifyResponseToken` throws BEFORE this is called, so an invalid or
 *      expired token never reaches a privileged client.
 *   2. Every candidate-facing read and write in the request takes the returned
 *      client explicitly, so a helper cannot quietly fall back to the session
 *      client and start returning nothing again.
 *
 * The narrowing that keeps this safe is the token itself: it names one
 * application, and every query below is keyed to that id. Recruiter-facing
 * actions stay on the cookie client and keep their ownership checks.
 */
function candidateDb(): SupabaseDb {
  return createAdminClient();
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
  const db = candidateDb();

  const app = await fetchApplicationForResponse(application_id, db);
  if (!app) {
    throw new Error(
      "We couldn't find this application. Please contact the hiring team."
    );
  }

  const response = await fetchScreeningResponseByApplicationId(application_id, db);
  if (!response) {
    throw new Error(
      "This link is no longer active. Please contact the hiring team for a new one."
    );
  }

  // A completed response is not an error — the candidate is done. `responded`
  // (awaiting scoring) and `scored` (reviewed) both mean "nothing left to do",
  // so return the status and let the page show a friendly confirmation rather
  // than throwing into the generic "couldn't open this link" error card. Only
  // `expired` (needs a new link) and the still-open states fall through.
  if (response.status === "responded" || response.status === "scored") {
    return {
      application_id,
      status: response.status,
      campaign_title: app.campaign_title,
      questions: [],
      existing_answers: {},
      expires_at,
    };
  }

  // A done candidate (responded/scored) is handled above; an OPEN response on a
  // frozen campaign must not show the form.
  assertCampaignAcceptingResponses(app.campaign_status);

  assertResponseIsOpen(response.status);

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id, db);

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
  const db = candidateDb();

  // IP rate limit — prevents abuse from an actor who has scraped a token.
  const ip = await getClientIp();
  checkRateLimit(ip, {
    name: "screening-submit",
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
  });

  const existing = await fetchScreeningResponseByApplicationId(application_id, db);
  if (!existing) {
    throw new Error(
      "This link is no longer active. Please contact the hiring team for a new one."
    );
  }

  assertResponseNotResubmitted(existing.status);

  // Look up the application's campaign so we can reload the authoritative
  // question set (with is_required flags) — and freeze the submission if the
  // campaign is no longer Active.
  const app = await fetchApplicationForResponse(application_id, db);
  if (!app) {
    throw new Error("This application no longer exists.");
  }
  assertCampaignAcceptingResponses(app.campaign_status);
  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id, db);
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

  await saveCandidateAnswers(application_id, answers, db);

  // Best-effort: the candidate's answers are durable; a transition failure
  // (illegal source state, RPC error) shouldn't surface as a submission
  // failure to the candidate. A recruiter sees the response and can advance
  // manually.
  await tryTransition(
    application_id,
    "screening_completed",
    "Candidate submitted screening answers",
  );

  return { ok: true };
}

// ─── Voice Screening (#83) ──────────────────────────────────────────────────

/**
 * Best-effort transition. The candidate has already left (call ended, or page
 * unloaded), so a transition failure must never surface to them — it's logged
 * and the recruiter can advance the application manually.
 *
 * Always the SYSTEM transition: these fire in a token-verified request with no
 * recruiter session, and the owner-scoped `transition_application` RPC would
 * reject them. Actor stays `system`, so the transitions log is unchanged.
 */
async function tryTransition(
  applicationId: string,
  toState: Parameters<typeof transitionApplicationAsSystem>[1],
  rationale: string,
): Promise<void> {
  try {
    await transitionApplicationAsSystem(applicationId, toState, rationale);
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
async function autoScoreScreening(
  applicationId: string,
  db: SupabaseDb,
): Promise<void> {
  try {
    const ctx = await fetchScoringContextByApplicationId(applicationId, db);
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
      db,
    });
  } catch (err) {
    console.error(
      `autoScoreScreening failed for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Open a LiveKit room for a candidate to take their voice screening on
 * `/respond/[token]`. Gated on a verified screening token (candidates have no
 * account) and IP-rate-limited. The returned grant only lets the browser join
 * that one room — the interview itself is run by the server-side agent worker,
 * which reads the instructions off the room metadata and reports the
 * transcript back through the agent API route.
 *
 * Lazy expiry: if the deadline has passed, the response is expired and the
 * application transitioned to `screening_expired` rather than opening a call.
 */
export async function startCandidateVoiceScreening(
  token: string,
): Promise<ScreeningRoomGrant> {
  const { application_id } = verifyResponseToken(token);
  const db = candidateDb();

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "voice-screening-start", ...VOICE_RATE_LIMIT });

  const app = await fetchApplicationForResponse(application_id, db);
  if (!app) {
    throw new ScreeningResponseError(
      "This link is no longer active. Please contact the hiring team for a new one.",
    );
  }

  const response = await fetchScreeningResponseByApplicationId(application_id, db);
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
    await expireScreeningResponse(application_id, db);
    throw new ScreeningResponseError(
      "This link has expired. Please contact the hiring team for a new one.",
    );
  }

  // Freeze the call unless the campaign is Active.
  assertCampaignAcceptingResponses(app.campaign_status);

  assertResponseIsOpen(response.status);

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id, db);
  if (questions.length === 0) {
    throw new ScreeningResponseError(
      "No screening questions are configured for this role.",
    );
  }

  const instructions = buildScreeningInstructions({
    jobTitle: app.campaign_title,
    questions: questions.map((q) => ({ prompt: q.prompt, is_required: q.is_required })),
  });

  return createScreeningRoomGrant({ applicationId: application_id, instructions });
}

/** Expire the response row and best-effort transition the application. */
async function expireScreeningResponse(
  applicationId: string,
  db: SupabaseDb,
): Promise<void> {
  await markScreeningResponseExpired(applicationId, db);
  await tryTransition(
    applicationId,
    "screening_expired",
    "Screening deadline passed before the candidate completed the voice call",
  );
}

/**
 * Finalize a completed voice screening call: promote the agent-reported
 * transcript draft to `responded` and advance `screening_sent →
 * screening_completed`. The recruiter's scoring action (#84) reads the
 * transcript from here.
 *
 * The browser sends only the token — the transcript itself was captured
 * SERVER-side by the agent worker and posted to the agent API route during
 * the call, so the candidate's machine never supplies evidence. A draft with
 * no candidate speech (interviewer questions only) is rejected: there is
 * nothing to score, and the candidate must re-record; a hard capture failure
 * goes through `reportVoiceScreeningFailure` instead.
 */
export async function submitVoiceScreening(input: {
  token: string;
  proctoringEvents?: unknown;
}): Promise<{ ok: true }> {
  const { application_id } = verifyResponseToken(input.token);
  const db = candidateDb();

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "voice-screening-submit", ...VOICE_RATE_LIMIT });

  const existing = await fetchScreeningResponseByApplicationId(application_id, db);
  if (!existing) {
    throw new ScreeningResponseError(
      "This link is no longer active. Please contact the hiring team for a new one.",
    );
  }

  assertResponseNotResubmitted(existing.status);

  // The agent reports turns incrementally during the call; by review time the
  // draft is normally complete. An empty/agent-only draft means the call never
  // captured an answer (or the last report is still in flight — retrying in a
  // moment resolves that).
  const transcript: VoiceTranscriptTurn[] = existing.transcript ?? [];
  if (!transcript.some((t) => t.role === "candidate")) {
    throw new ScreeningResponseError(
      "The call didn't capture any spoken answers — please wait a moment and try again, or re-record.",
    );
  }

  // Freeze the submission (and the auto-score that follows) unless the campaign
  // is Active.
  const app = await fetchApplicationForResponse(application_id, db);
  if (app) assertCampaignAcceptingResponses(app.campaign_status);

  // Before saveVoiceTranscript — the proctoring write is guarded to `sent`, and
  // saving the transcript is what flips the row to `responded`.
  await tryRecordScreeningProctoring(application_id, input.proctoringEvents, db);

  await saveVoiceTranscript(application_id, transcript, db);

  await tryTransition(
    application_id,
    "screening_completed",
    "Candidate completed the voice screening call",
  );

  // Score the call automatically — no recruiter click required — but AFTER
  // the response: AI scoring takes seconds and the candidate's "done" screen
  // must not wait on it. Best-effort; failures are logged, never surfaced
  // (the transcript is durable and a recruiter can still score manually).
  after(() => autoScoreScreening(application_id, db));

  return { ok: true };
}

/**
 * Persist the browser's proctoring observations for a finished voice screening.
 *
 * Screening is the stage a candidate has the most reason to game — the question
 * is asked before the answer is given, and "hold on a second" costs nothing — so
 * tab-focus evidence is worth capturing here even though this stage can only
 * ever have the browser half of it. There is no camera in a voice call, so
 * nothing corroborates what the client reports: a candidate who edits the
 * payload produces a clean report. That is a real limit of the signal, not a bug
 * to fix here, and the recruiter UI states it rather than implying certainty.
 *
 * Best-effort throughout, mirroring the interview: an absent report leaves the
 * column null (rendered as "not captured", never as "clean"), a malformed one is
 * logged and discarded, and neither can cost the candidate their screening.
 * Rejecting bad input would buy nothing — `[]` is always available to anyone
 * who wants a clean report.
 */
async function tryRecordScreeningProctoring(
  applicationId: string,
  rawEvents: unknown,
  db: SupabaseDb,
): Promise<void> {
  if (rawEvents === undefined || rawEvents === null) return;

  const parsed = proctoringEventsSchema.safeParse(rawEvents);
  if (!parsed.success) {
    console.warn(
      `Discarding malformed screening proctoring report for ${applicationId}:`,
      parsed.error.message,
    );
    return;
  }

  try {
    const report = summarizeProctoring(parsed.data);
    await saveScreeningProctoringReport(applicationId, report, db);
  } catch (err) {
    console.error(
      `Failed to save screening proctoring report for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
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
  const db = candidateDb();

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "voice-screening-submit", ...VOICE_RATE_LIMIT });

  const existing = await fetchScreeningResponseByApplicationId(application_id, db);
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
