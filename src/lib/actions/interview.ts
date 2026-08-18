"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { uuidSchema, proctoringEventsSchema } from "@/lib/validations";
import {
  attachSnapshots,
  summarizeProctoring,
  type ProctoringEvent,
  type ProctoringSnapshot,
  type VisionObservation,
} from "@/lib/proctoring/incidents";
import {
  peekResponseToken,
  TOKEN_EXPIRED_MESSAGE,
  verifyResponseToken,
  type VerifiedToken,
} from "@/lib/auth/screening-token";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import {
  deleteProctoringSnapshots,
  fetchInterviewContextByApplicationId,
  fetchInterviewScoringContext,
  getProctoringSnapshotSignedUrls,
  type InterviewCandidateContext,
} from "@/lib/data/candidates";
import { runInterviewScoring } from "./interview-scoring";
import {
  fetchInterviewSessionByApplicationId,
  ensureInterviewSession,
  markInterviewExpired,
  markInterviewStarted,
  saveProctoringReport,
  saveProctoringSnapshots,
  finalizeInterviewTranscript,
  type InterviewSessionRow,
  type InterviewSessionStatus,
  type InterviewTranscriptTurn,
} from "@/lib/data/interview-sessions";
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
import type { ApplicationState, CampaignStatus, Disposition } from "@/lib/constants";

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
  disposition?: Disposition,
): Promise<void> {
  try {
    await transitionApplicationAsSystem(applicationId, toState, rationale, disposition);
  } catch (err) {
    console.error(
      `Failed to transition ${applicationId} → ${toState}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

const LAZY_EXPIRY_RATIONALE =
  "Interview deadline passed before the candidate completed the AI interview";

/**
 * Close out a lapsed invitation: move the application to `interview_expired` and
 * flip the session row. Best-effort on both halves — the candidate is being told
 * their link is dead either way, and a failure here must not turn into a stack
 * trace on their screen.
 */
async function expireInterviewInvitation(applicationId: string): Promise<void> {
  await tryTransition(applicationId, "interview_expired", LAZY_EXPIRY_RATIONALE, {
    code: "EXPIRED",
    description: LAZY_EXPIRY_RATIONALE,
  });

  try {
    await markInterviewExpired(applicationId, createAdminClient());
  } catch (err) {
    console.error(
      `Failed to expire interview session for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Token gate for the candidate's interview pages, with lazy expiry.
 *
 * The deadline lives in the token itself, so a plain `verifyResponseToken`
 * throws on a lapsed link and the application never learns it went stale — which
 * is why an invited no-show could sit in `interview_invited` forever. Peeking
 * authenticates the token first (a forged one still throws), then uses the
 * application id it recovers to close the invitation out before reporting the
 * same expired message to the candidate.
 *
 * The candidate sees no difference; the pipeline does.
 */
async function verifyLiveInterviewToken(token: string): Promise<VerifiedToken> {
  const { application_id, expires_at, expired } = peekResponseToken(token);

  if (expired) {
    await expireInterviewInvitation(application_id);
    throw new Error(TOKEN_EXPIRED_MESSAGE);
  }

  return { application_id, expires_at };
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
  const { application_id, expires_at } = await verifyLiveInterviewToken(token);

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
  const ip = await getClientIp();
  checkRateLimit(ip, { name: "interview-start", ...INTERVIEW_RATE_LIMIT });

  // Rate-limited BEFORE the peek: the expiry path writes, so an unthrottled
  // caller could otherwise hammer it with one dead token.
  const { application_id, expires_at } = await verifyLiveInterviewToken(token);

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

  // The candidate's video is never recorded or stored: it exists only as a live
  // LiveKit track, which the agent worker samples in-memory for proctoring and
  // discards. There is deliberately no egress here.
  return createInterviewRoomGrant({ applicationId: application_id, instructions });
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
  // and finalize is what closes them. The worker's vision samples were reported
  // during the call and are folded in here alongside the browser's events.
  await tryRecordProctoring(
    application_id,
    input.proctoringEvents,
    session.proctoring_observations ?? [],
    session.proctoring_snapshots ?? [],
    db,
  );

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
 * Persist the proctoring report for a finished interview (Phases C + C2).
 * Best-effort by design: proctoring is supporting evidence, so a malformed or
 * failed report must never cost the candidate their interview.
 *
 * Two independent evidence streams meet here. `rawEvents` come from the
 * candidate's browser and are untrusted — a malformed payload is discarded
 * rather than rejected, because a candidate who wants to hide incidents can just
 * send `[]`, so failing the submit would punish only the honest. `observations`
 * were captured server-side by the agent worker during the call and are already
 * schema-bounded at the reporting route; they are folded in whether or not the
 * browser reported anything, which is precisely why they are the harder signal
 * to defeat.
 *
 * Distinguishes "no report" from "clean report": with neither stream present the
 * column stays null and the recruiter UI says proctoring wasn't captured, while
 * an empty browser array with vision samples records a genuine watched run.
 *
 * Uses the admin client because this runs in the session-less candidate request.
 */
async function tryRecordProctoring(
  applicationId: string,
  rawEvents: unknown,
  observations: VisionObservation[],
  snapshots: ProctoringSnapshot[],
  db: SupabaseDb,
): Promise<void> {
  const noBrowserReport = rawEvents === undefined || rawEvents === null;

  let events: ProctoringEvent[] = [];
  let hasReport = !noBrowserReport || observations.length > 0;

  if (!noBrowserReport) {
    const parsed = proctoringEventsSchema.safeParse(rawEvents);
    if (parsed.success) {
      events = parsed.data;
    } else {
      // Keep going: the worker's vision evidence stands on its own, and dropping
      // it because the browser sent junk would hand a candidate an easy way to
      // erase the one signal their machine doesn't control.
      console.warn(
        `Discarding malformed browser proctoring report for ${applicationId}:`,
        parsed.error.message,
      );
      hasReport = observations.length > 0;
    }
  }

  // Default: nothing references any still. Writing a report is what rescues the
  // ones that turned out to be evidence — so every path out of this function
  // ends at the same prune, and no exit can leave images behind.
  let orphanedKeys = snapshots.map((s) => s.key);

  if (hasReport) {
    try {
      const summary = summarizeProctoring(events, observations);
      // Only stills that landed inside a CONFIRMED incident survive. The rest
      // are frames the detector flagged and the rules then rejected — the
      // pictures behind its own false positives, the last thing worth keeping.
      const attached = attachSnapshots(summary, snapshots);
      await saveProctoringReport(applicationId, attached.report, db);
      orphanedKeys = attached.orphanedKeys;
    } catch (err) {
      console.error(
        `Failed to save proctoring report for ${applicationId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await tryPruneSnapshots(applicationId, snapshots, orphanedKeys, db);
}

/**
 * Delete the evidence stills nothing references, and point the session's index
 * at what's left.
 *
 * Takes the full set plus the orphans and derives what's kept, so "orphaned"
 * has exactly one definition rather than one per caller.
 *
 * Best-effort in both halves and in that order: a failed delete leaves an
 * unreferenced object (tidy-up debt), while a failed index write would leave the
 * report pointing at an image that has already been removed. Neither may cost
 * the candidate their submit.
 */
async function tryPruneSnapshots(
  applicationId: string,
  snapshots: ProctoringSnapshot[],
  orphanedKeys: string[],
  db: SupabaseDb,
): Promise<void> {
  if (snapshots.length === 0) return;
  const orphaned = new Set(orphanedKeys);
  const kept = snapshots.filter((s) => !orphaned.has(s.key));

  try {
    await deleteProctoringSnapshots(orphanedKeys, db);
  } catch (err) {
    console.error(
      `Failed to prune proctoring snapshots for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  try {
    await saveProctoringSnapshots(applicationId, kept, db);
  } catch (err) {
    console.error(
      `Failed to update snapshot index for ${applicationId}:`,
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

/** The session plus short-lived URLs for whatever evidence stills it carries. */
export interface InterviewSessionView extends InterviewSessionRow {
  /** Incident snapshot key → signed URL, minted fresh on each read. */
  snapshot_urls: Record<string, string>;
}

/**
 * Recruiter-facing read of an application's interview session (transcript +
 * status + score + proctoring) for the candidate detail page. Session-guarded;
 * RLS scopes the row to the recruiter's own campaigns. Returns null for a bad id
 * or no session yet.
 *
 * There is no recording to resolve — the interview is never captured to storage.
 * What a proctoring finding CAN be checked against is its evidence still, so the
 * stored object keys are resolved to time-limited signed URLs here, the same way
 * résumés are. A key that no longer resolves is simply omitted: an incident
 * without a picture still renders.
 */
export async function getInterviewSession(
  applicationId: string,
): Promise<InterviewSessionView | null> {
  await requireUserId();
  if (!uuidSchema.safeParse(applicationId).success) return null;

  const row = await fetchInterviewSessionByApplicationId(applicationId);
  if (!row) return null;

  const keys = (row.proctoring?.incidents ?? [])
    .map((i) => i.snapshot_key)
    .filter((k): k is string => typeof k === "string");

  return { ...row, snapshot_urls: await getProctoringSnapshotSignedUrls(keys) };
}
