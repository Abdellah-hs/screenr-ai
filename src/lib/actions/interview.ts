"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { uuidSchema, proctoringEventsSchema } from "@/lib/validations";
import { summarizeProctoring } from "@/lib/proctoring/incidents";
import { verifyResponseToken } from "@/lib/auth/screening-token";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import {
  fetchInterviewContextByApplicationId,
  fetchInterviewScoringContext,
  getInterviewRecordingSignedUrl,
  type InterviewCandidateContext,
} from "@/lib/data/candidates";
import { runInterviewScoring } from "./interview-scoring";
import {
  fetchInterviewSessionByApplicationId,
  ensureInterviewSession,
  markInterviewStarted,
  saveInterviewRecording,
  saveProctoringReport,
  finalizeInterviewTranscript,
  type InterviewSessionRow,
  type InterviewSessionStatus,
  type InterviewTranscriptTurn,
} from "@/lib/data/interview-sessions";
import {
  isInterviewRecordingConfigured,
  startInterviewRecording,
} from "@/lib/services/livekit-egress";
import {
  buildInterviewInstructions,
  type InterviewResume,
} from "@/lib/services/interview";
import {
  createInterviewRoomGrant,
  type InterviewRoomGrant,
} from "@/lib/services/livekit";
import { isCampaignProcessingActive } from "@/lib/rules/campaign-status";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";
import type { ApplicationState, CampaignStatus } from "@/lib/constants";

/**
 * Public server actions for the on-demand AI video interview
 * (`/interview/[token]`). Candidates have no account — every entry point is
 * gated on a verified interview token (same HMAC machinery as screening) and
 * IP-rate-limited. The interview itself is run by the server-side agent worker
 * (`agents/interview/`), which reads the résumé-grounded instructions off the
 * room metadata and reports the transcript back through the agent API route.
 *
 * State stays rule-driven: the agent produces the transcript (evidence); the
 * candidate's explicit submit is what finalizes it and advances the application
 * (`interview_invited → interview_completed`) via the system transition.
 *
 * Every DB touch on this path uses the ADMIN client, because there is no
 * candidate account: `applications`, `candidates`, and `interview_sessions` are
 * all owner-only RLS, so the cookie client sees an empty database here and the
 * page would report a dead link for a perfectly valid one. The signed token IS
 * the authorization — it is verified before the client is ever built.
 */

const INTERVIEW_RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 10 * 60 * 1000,
} as const;

// Neutral by design — must not leak the internal status word or any ranking
// (PRD candidate-facing constraints).
const INTERVIEW_ON_HOLD_MESSAGE =
  "This interview is currently on hold. Please check back later or contact the hiring team.";

const LINK_DEAD_MESSAGE =
  "This link is no longer active. Please contact the hiring team for a new one.";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Best-effort transition — the candidate has already left; never surface it.
 * Uses the SYSTEM transition: the owner-checked `transitionApplication` reads
 * the application through the cookie client, which finds nothing in a
 * session-less candidate request.
 */
async function tryTransition(
  applicationId: string,
  toState: ApplicationState,
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

function assertCampaignAcceptingInterview(status: CampaignStatus): void {
  if (!isCampaignProcessingActive(status)) {
    throw new Error(INTERVIEW_ON_HOLD_MESSAGE);
  }
}

/** Map the parsed résumé + candidate name into the interviewer's reference shape. */
function toInterviewResume(ctx: InterviewCandidateContext): InterviewResume | null {
  const fullName = [ctx.candidate_first_name, ctx.candidate_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const r = ctx.resume;
  if (!r) return fullName ? { fullName } : null;

  const resumeName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return {
    fullName: fullName || resumeName || undefined,
    headline: r.headline,
    summary: r.summary,
    skills: r.skills,
    experience: r.experience,
    education: r.education,
  };
}

export interface InterviewPageContext {
  application_id: string;
  campaign_title: string;
  status: InterviewSessionStatus;
  /** ISO deadline surfaced to the candidate. */
  expires_at: string;
}

/**
 * Load the interview page. Verifies the token (throws with a user-facing
 * message on an invalid/expired link), then returns the campaign framing and
 * the session status so the page can show the intro, the "already done"
 * confirmation, or the expired notice. Reads only — safe on every page load.
 */
export async function loadInterviewContext(token: string): Promise<InterviewPageContext> {
  const { application_id, expires_at } = verifyResponseToken(token);

  const db = createAdminClient();

  const ctx = await fetchInterviewContextByApplicationId(application_id, db);
  if (!ctx) throw new Error(LINK_DEAD_MESSAGE);

  const session = await fetchInterviewSessionByApplicationId(application_id, db);

  return {
    application_id,
    campaign_title: ctx.campaign_title,
    status: session?.status ?? "invited",
    expires_at: expires_at.toISOString(),
  };
}

/**
 * Open a LiveKit video room for the candidate's AI interview. Gated on a
 * verified token + IP rate limit. Ensures the session row exists, marks it
 * live, builds résumé-grounded instructions, and returns a grant that only
 * lets the browser join that one room — the interview is run by the agent
 * worker, which reads the instructions off the room metadata.
 */
export async function startCandidateInterview(token: string): Promise<InterviewRoomGrant> {
  const { application_id, expires_at } = verifyResponseToken(token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "interview-start", ...INTERVIEW_RATE_LIMIT });

  const db = createAdminClient();

  const ctx = await fetchInterviewContextByApplicationId(application_id, db);
  if (!ctx) throw new Error(LINK_DEAD_MESSAGE);

  assertCampaignAcceptingInterview(ctx.campaign_status);

  const session = await fetchInterviewSessionByApplicationId(application_id, db);
  if (session?.status === "completed") {
    throw new Error("You've already completed this interview. The hiring team will be in touch.");
  }

  await ensureInterviewSession(application_id, expires_at, db);
  await markInterviewStarted(application_id, db);

  const instructions = buildInterviewInstructions({
    jobTitle: ctx.campaign_title,
    resume: toInterviewResume(ctx),
  });

  const grant = await createInterviewRoomGrant({ applicationId: application_id, instructions });

  // Best-effort recording (Phase B2). Started BEFORE the grant is returned so
  // egress is already capturing when the candidate joins — the room exists, and
  // a failure here never blocks the interview (recording just doesn't happen).
  await tryStartRecording(application_id, ctx.campaign_id, grant.roomName, db);

  return grant;
}

/**
 * Start the LiveKit egress recording for this interview room and store its
 * storage key on the session. Best-effort: skipped cleanly when recording isn't
 * configured, and any failure is logged, never surfaced — the interview runs
 * regardless. Uses the admin client because this is a session-less candidate
 * request. Storage key is `<campaignId>/<applicationId>.mp4` (owner-scoped by
 * the private bucket's RLS).
 */
async function tryStartRecording(
  applicationId: string,
  campaignId: string,
  roomName: string,
  db: SupabaseDb,
): Promise<void> {
  if (!isInterviewRecordingConfigured()) return;
  try {
    const { storageKey } = await startInterviewRecording({
      roomName,
      campaignId,
      applicationId,
    });
    await saveInterviewRecording(applicationId, storageKey, db);
  } catch (err) {
    console.error(
      `Failed to start interview recording for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Finalize a completed interview: promote the agent-reported transcript draft
 * and advance `interview_invited → interview_completed`. The transcript was
 * captured SERVER-side by the agent worker, so the candidate's machine never
 * supplies it. A draft with no candidate speech is rejected (nothing to score;
 * the candidate should retry).
 *
 * `proctoringEvents` is the one thing the browser does supply, because tab focus
 * and the local camera are only observable there (Phase C). It is treated as
 * untrusted: Zod-bounded, and severity is decided server-side.
 */
export async function submitInterview(input: {
  token: string;
  proctoringEvents?: unknown;
}): Promise<{ ok: true }> {
  const { application_id } = verifyResponseToken(input.token);

  const ip = await getClientIp();
  checkRateLimit(ip, { name: "interview-submit", ...INTERVIEW_RATE_LIMIT });

  const db = createAdminClient();

  const session = await fetchInterviewSessionByApplicationId(application_id, db);
  if (!session) throw new Error(LINK_DEAD_MESSAGE);

  // Idempotent: a double-submit (two tabs, a retry) is not an error.
  if (session.status === "completed") return { ok: true };

  const transcript: InterviewTranscriptTurn[] = session.transcript ?? [];
  if (!transcript.some((t) => t.role === "candidate")) {
    throw new Error(
      "The interview didn't capture any of your answers — please wait a moment and try again, or restart the interview.",
    );
  }

  // Before finalizing — the proctoring write is guarded to the open statuses,
  // and finalize is what closes them.
  await tryRecordProctoring(application_id, input.proctoringEvents, db);

  await finalizeInterviewTranscript(application_id, transcript, db);

  await tryTransition(
    application_id,
    "interview_completed",
    "Candidate completed the AI video interview",
  );

  // Score the interview automatically — no recruiter click required — but AFTER
  // the response, so the candidate's "done" screen never waits on AI scoring.
  // Best-effort; failures are logged, never surfaced (the transcript is durable
  // and a recruiter can still score manually). The advancement stays rule-driven
  // inside runInterviewScoring (Control > AI > Data).
  after(() => autoScoreInterview(application_id));

  return { ok: true };
}

/**
 * Persist the browser's proctoring observations for a finished interview
 * (Phase C). Best-effort by design: proctoring is supporting evidence, so a
 * malformed or failed report must never cost the candidate their interview.
 *
 * Distinguishes "no report" from "clean report" — an absent `proctoringEvents`
 * leaves the column null (the recruiter UI then says proctoring wasn't captured),
 * while an empty array records a genuine clean run. Rejecting a malformed payload
 * would buy nothing: a candidate who wants to hide incidents can just send `[]`.
 *
 * Uses the admin client because this runs in the session-less candidate request.
 */
async function tryRecordProctoring(
  applicationId: string,
  rawEvents: unknown,
  db: SupabaseDb,
): Promise<void> {
  if (rawEvents === undefined || rawEvents === null) return;

  const parsed = proctoringEventsSchema.safeParse(rawEvents);
  if (!parsed.success) {
    console.warn(
      `Discarding malformed proctoring report for ${applicationId}:`,
      parsed.error.message,
    );
    return;
  }

  try {
    const report = summarizeProctoring(parsed.data);
    await saveProctoringReport(applicationId, report, db);
  } catch (err) {
    console.error(
      `Failed to save proctoring report for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Best-effort auto-scoring right after a completed interview. Runs in the
 * candidate's token-verified request, where there is no recruiter session, so
 * it resolves the campaign config + owner from the application alone via the
 * admin client. A failure must never surface to the candidate (they've already
 * left): the transcript is persisted and a recruiter can score manually.
 */
async function autoScoreInterview(applicationId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const ctx = await fetchInterviewScoringContext(applicationId, db);
    if (!ctx?.description) {
      console.warn(
        `autoScoreInterview: skipping ${applicationId} — campaign has no job description to score against.`,
      );
      return;
    }
    await runInterviewScoring({
      applicationId,
      campaignId: ctx.campaign_id,
      candidateId: ctx.candidate_id,
      ownerUserId: ctx.owner_user_id,
      description: ctx.description,
      resumeSummary: ctx.resume_summary,
    });
  } catch (err) {
    console.error(
      `autoScoreInterview failed for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** An interview session plus a freshly-minted, short-lived playback URL for its
 *  recording (null when there's no recording or it isn't ready yet). */
export interface InterviewSessionView extends InterviewSessionRow {
  recording_signed_url: string | null;
}

/**
 * Recruiter-facing read of an application's interview session (transcript +
 * status + recording) for the candidate detail page. Session-guarded; RLS
 * scopes the row to the recruiter's own campaigns. The stored `recording_url` is
 * a private storage KEY — resolve it to a time-limited signed URL here so the
 * page can play it back. Returns null for a bad id or no session yet.
 */
export async function getInterviewSession(
  applicationId: string,
): Promise<InterviewSessionView | null> {
  await requireUserId();
  if (!uuidSchema.safeParse(applicationId).success) return null;

  const row = await fetchInterviewSessionByApplicationId(applicationId);
  if (!row) return null;

  const recording_signed_url = row.recording_url
    ? await getInterviewRecordingSignedUrl(row.recording_url)
    : null;

  return { ...row, recording_signed_url };
}
