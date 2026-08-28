import { createClient } from "@/lib/supabase/server";
import type { SupabaseDb } from "@/lib/supabase/types";
import type { ScoredInterviewDimension } from "@/lib/interview-scoring";
import type { Json } from "@/types/database.types";
import type {
  ProctoringReport,
  ProctoringSnapshot,
  StoredProctoringSnapshot,
  VisionObservation,
} from "@/lib/proctoring/incidents";

/**
 * Data layer for AI video-interview sessions (Phase A).
 *
 * The interview analogue of the voice-transcript helpers in
 * `screening-questions.ts`: one `interview_sessions` row per application holds
 * the live transcript draft + lifecycle status. No auth or validation here —
 * that's the action's / route's job. Functions take an optional `db` so the
 * agent route and session-less flows can pass the admin client; everything else
 * uses the request-scoped cookie client.
 */

/** One spoken turn of an interview, in conversation order. */
export interface InterviewTranscriptTurn {
  role: "agent" | "candidate";
  text: string;
  /** ISO timestamp the turn was captured server-side. */
  at: string;
}

export type InterviewSessionStatus =
  | "invited"
  | "in_progress"
  | "completed"
  | "expired"
  | "failed";

/** One scored competency of an interview, with the model's rationale. */
export interface InterviewDimension {
  name: string;
  score: number;
  rationale: string;
  /**
   * The candidate's own words behind this score, and which transcript turn they
   * came from (PRD 3.10.2). Both optional: sessions scored before #148 have
   * neither, because the scorer verified the quote and then discarded it.
   * Absent reads as "no linkable evidence", which is honest for those rows.
   */
  evidence_quote?: string;
  evidence_turn_index?: number | null;
}

/**
 * Persisted interview score (Phase B), stored on `interview_sessions.scores`.
 * Independent stage evidence (CLAUDE.md) — no rollup with resume/screening.
 */
export interface InterviewScore {
  overall_score: number;
  overall_rationale: string;
  /**
   * Legacy per-competency numbers, from the scorer that asked the model for
   * 0-100 and let it choose the competencies. Empty on every interview scored
   * since 2026-08-28 — `dimension_scores` carries the breakdown now.
   */
  dimensions: InterviewDimension[];
  /**
   * The evidence-based rubric breakdown.
   *
   * **Null means the interview was scored by the old numeric prompt** (anything
   * before 2026-08-28) and renders from `dimensions`. History is not
   * back-filled: a score should show the unit it was actually graded in, and
   * the two are not comparable — the old overall was an unweighted mean of
   * model-chosen competencies, this one a weighted mean over the recruiter's
   * rubric. The same rule screening applied to `dimension_scores` in #163.
   */
  dimension_scores?: ScoredInterviewDimension[] | null;
  /** Which arithmetic produced the overall. Null on the legacy numeric path. */
  rules_version?: string | null;
  /**
   * How much of the rubric the interview actually reached: the number of
   * assessed dimensions and their share of the rubric's weight (0-1).
   *
   * Not optional decoration. Since v2 the overall is the mean over the ASSESSED
   * dimensions only, so 100 from one dimension of five and 80 from all five are
   * both plausible numbers that mean very different things. Absent on scores
   * written before this, which is honest — nothing measured it then.
   */
  covered_count?: number;
  covered_weight?: number;
  /** Quotes discarded and levels downgraded on the way to this score. */
  validation_warnings?: string[];
  /**
   * Free-text summaries from the retired numeric scorer. Empty since
   * 2026-08-28: the per-dimension notes and the overall rationale say the same
   * things against the rubric, and a second free-text field would have meant
   * forking the evidence schema the two spoken stages now share.
   */
  strengths: string[];
  concerns: string[];
  /** interview-stage rubric version active at score time (staleness tracking). */
  rubric_version: number | null;
  scored_at: string;
}

export interface InterviewSessionRow {
  id: string;
  application_id: string;
  status: InterviewSessionStatus;
  transcript: InterviewTranscriptTurn[];
  scores: InterviewScore | null;
  proctoring: ProctoringReport | null;
  /**
   * Draft vision-proctoring samples reported by the worker during the call
   * (Phase C2). Raw evidence — `summarizeProctoring` folds these into
   * `proctoring` at submit.
   */
  proctoring_observations: VisionObservation[] | null;
  /**
   * Draft index of evidence stills captured during the call. Pruned to the
   * confirmed incidents at submit — see `attachSnapshots`.
   */
  proctoring_snapshots: StoredProctoringSnapshot[] | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** Statuses in which the session is still "open" — draft writes are allowed. */
const OPEN_STATUSES = ["invited", "in_progress"] as const;

// The generated row types don't model chained `.update().eq().in()` ergonomically;
// the rest of the data layer uses the same `as any` escape hatch for query chains.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function resolveDb(db?: SupabaseDb): Promise<AnyDb> {
  return (db ?? (await createClient())) as AnyDb;
}

export async function fetchInterviewSessionByApplicationId(
  applicationId: string,
  db?: SupabaseDb,
): Promise<InterviewSessionRow | null> {
  const q = await resolveDb(db);
  const { data, error } = await q
    .from("interview_sessions")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching interview session:", JSON.stringify(error, null, 2));
    return null;
  }
  return (data ?? null) as InterviewSessionRow | null;
}

/**
 * Create the session row for an application if one doesn't exist yet, at status
 * `invited` with the link deadline. Idempotent: `ignoreDuplicates` on the
 * `application_id` unique key means a repeat call (re-invite, candidate reload)
 * never clobbers an in-progress/completed session.
 */
export async function ensureInterviewSession(
  applicationId: string,
  expiresAt: Date | null,
  db?: SupabaseDb,
): Promise<void> {
  const q = await resolveDb(db);
  const { error } = await q
    .from("interview_sessions")
    .upsert(
      {
        application_id: applicationId,
        status: "invited",
        expires_at: expiresAt ? expiresAt.toISOString() : null,
      },
      { onConflict: "application_id", ignoreDuplicates: true },
    );

  if (error) {
    throw new Error(
      `Failed to ensure interview session: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Mark the session live when the candidate starts the call. Guarded to the open
 * statuses so a late call can't reopen a completed/expired session.
 */
export async function markInterviewStarted(
  applicationId: string,
  db?: SupabaseDb,
): Promise<void> {
  const q = await resolveDb(db);
  const { error } = await q
    .from("interview_sessions")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to mark interview started: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Persist the proctoring report for an interview (Phase C). Guarded to the open
 * statuses like the other candidate-path writes, so a late or replayed report
 * can't attach itself to an already-finalized session — callers therefore write
 * this BEFORE `finalizeInterviewTranscript` flips the row to `completed`.
 *
 * Observational only: this stores evidence and nothing else. It never changes
 * session status and never feeds the interview score.
 */
export async function saveProctoringReport(
  applicationId: string,
  report: ProctoringReport,
  db: SupabaseDb,
): Promise<void> {
  const q = db as AnyDb;
  const { error } = await q
    .from("interview_sessions")
    .update({ proctoring: report })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to save proctoring report: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Persist the worker's vision-proctoring samples as a DRAFT (Phase C2). The
 * worker reports the full set so far after each new sample, so this is an
 * idempotent overwrite — a retry or a duplicate report can't double-count, and a
 * crashed worker loses at most the final sample.
 *
 * Guarded to the open statuses like the transcript draft, so a late-arriving
 * report can never attach evidence to an interview that was already finalized.
 * Called from the agent API route with the admin client (no user session).
 */
export async function saveVisionObservationsDraft(
  applicationId: string,
  observations: VisionObservation[],
  db: SupabaseDb,
): Promise<void> {
  const q = db as AnyDb;
  const { error } = await q
    .from("interview_sessions")
    .update({ proctoring_observations: observations })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to save vision observations: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Upload one evidence still and append it to the session's draft index.
 *
 * Append rather than overwrite (unlike the observation draft, which the worker
 * re-sends whole): each image is uploaded once and the row only carries its key,
 * so re-sending the whole set would mean re-uploading every image. The read
 * → append → write is not atomic, but the only writer is a single serialized
 * chain in one worker, so there is nothing to race with.
 *
 * Guarded to the open statuses like every other candidate-path write: a late
 * report can't attach evidence to a finalized interview.
 *
 * Returns false when the session isn't open — the caller then deletes the object
 * it just uploaded rather than leaving it orphaned in the bucket.
 */
export async function appendProctoringSnapshot(
  applicationId: string,
  snapshot: ProctoringSnapshot,
  db: SupabaseDb,
): Promise<boolean> {
  const q = db as AnyDb;

  const { data: existing, error: readError } = await q
    .from("interview_sessions")
    .select("proctoring_snapshots,status")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (readError) {
    throw new Error(
      `Failed to read snapshot draft: ${readError.message ?? JSON.stringify(readError)}`,
    );
  }
  if (!existing || !OPEN_STATUSES.includes(existing.status)) return false;

  const next = [...(existing.proctoring_snapshots ?? []), snapshot];

  const { error } = await q
    .from("interview_sessions")
    .update({ proctoring_snapshots: next })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to save proctoring snapshot: ${error.message ?? JSON.stringify(error)}`,
    );
  }
  return true;
}

/**
 * Replace the draft snapshot index with the stills that survived pruning. Called
 * at submit alongside the finalized report, so the row never points at an object
 * that was just deleted from the bucket.
 */
export async function saveProctoringSnapshots(
  applicationId: string,
  // Whatever survived the prune, at whatever vintage it was written: this
  // rewrites the index, so a legacy single-label row must go back as it was
  // rather than being silently reshaped by the code that happened to read it.
  snapshots: StoredProctoringSnapshot[],
  db: SupabaseDb,
): Promise<void> {
  const q = db as AnyDb;
  const { error } = await q
    .from("interview_sessions")
    .update({ proctoring_snapshots: snapshots })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to save proctoring snapshots: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Persist the agent-reported transcript of a live interview as a DRAFT. Guarded
 * to the open statuses so a late-arriving agent report can never rewrite a
 * session that was already finalized/expired. Called from the agent API route
 * with the admin client (no user session).
 */
export async function saveInterviewTranscriptDraft(
  applicationId: string,
  transcript: InterviewTranscriptTurn[],
  db: SupabaseDb,
): Promise<void> {
  const q = db as AnyDb;
  const { error } = await q
    .from("interview_sessions")
    .update({ transcript })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to save interview transcript draft: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Promote the transcript to final and mark the session completed. The matching
 * application transition (`interview_invited → interview_completed`) is the
 * action's job — this only flips the session row.
 */
export async function finalizeInterviewTranscript(
  applicationId: string,
  transcript: InterviewTranscriptTurn[],
  db?: SupabaseDb,
): Promise<void> {
  const q = await resolveDb(db);
  const { error } = await q
    .from("interview_sessions")
    .update({
      status: "completed",
      transcript,
      completed_at: new Date().toISOString(),
    })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to finalize interview transcript: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

export async function markInterviewExpired(
  applicationId: string,
  db?: SupabaseDb,
): Promise<void> {
  const q = await resolveDb(db);
  const { error } = await q
    .from("interview_sessions")
    .update({ status: "expired" })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to expire interview session: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/** An open, past-deadline session — the raw candidate set for the expiry sweep. */
export interface OverdueInterviewSession {
  application_id: string;
  status: "invited" | "in_progress";
  expires_at: string | null;
  started_at: string | null;
}

/**
 * Interview sessions still open (`invited` or `in_progress`) but past their
 * deadline — the input to the proactive expiry sweep. Mirrors
 * `fetchExpiredSentScreeningAppIds`.
 *
 * `in_progress` is included deliberately: a candidate who opened the room and
 * walked away never submits, so the session stays open forever. But a started
 * session might also be a live call that crossed its deadline mid-answer, so
 * this returns `status` + `started_at` and lets `isInterviewAbandoned` decide —
 * the query selects candidates, the rule closes them.
 *
 * Sessions with a null `expires_at` are excluded: no deadline means nothing to
 * be past, and guessing one would close a live interview.
 */
export async function fetchOverdueInterviewSessions(
  now: Date,
  db: SupabaseDb,
): Promise<OverdueInterviewSession[]> {
  const q = db as AnyDb;

  const { data, error } = await q
    .from("interview_sessions")
    .select("application_id, status, expires_at, started_at")
    .in("status", [...OPEN_STATUSES])
    .not("expires_at", "is", null)
    .lt("expires_at", now.toISOString());

  if (error) {
    throw new Error(
      `Failed to load expired interview sessions: ${error.message ?? JSON.stringify(error)}`,
    );
  }

  return (data ?? []) as OverdueInterviewSession[];
}

export async function markInterviewFailed(
  applicationId: string,
  db?: SupabaseDb,
): Promise<void> {
  const q = await resolveDb(db);
  const { error } = await q
    .from("interview_sessions")
    .update({ status: "failed" })
    .eq("application_id", applicationId)
    .in("status", [...OPEN_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to mark interview failed: ${error.message ?? JSON.stringify(error)}`,
    );
  }
}

/**
 * Persist the AI interview score on the session AND its audit-log evidence, per
 * CLAUDE.md's "Mandatory AI Output Persistence" rule. The score is the
 * interview analogue of `saveAnswerScores`. Session status is unchanged (the
 * APPLICATION advancing to `interview_scored` is the action's job); this only
 * writes the evidence.
 *
 * Runs on an injected `db` because the auto-score fires in the candidate's
 * session-less submit request — the caller passes the admin client there.
 */
export async function saveInterviewScore(
  args: {
    applicationId: string;
    campaignId: string;
    candidateId: string;
    score: InterviewScore;
    audit: {
      model: string;
      promptVersion: string;
      rawOutput: string;
      inputSnapshot: Json;
    };
  },
  db: SupabaseDb,
): Promise<void> {
  const q = db as AnyDb;

  const { error: updateError } = await q
    .from("interview_sessions")
    .update({ scores: args.score })
    .eq("application_id", args.applicationId);

  if (updateError) {
    throw new Error(
      `Failed to save interview score: ${updateError.message ?? JSON.stringify(updateError)}`,
    );
  }

  const { error: auditError } = await q.from("ai_audit_log").insert({
    campaign_id: args.campaignId,
    candidate_id: args.candidateId,
    stage: "interview_scoring",
    model: args.audit.model,
    prompt_version: args.audit.promptVersion,
    rubric_version:
      args.score.rubric_version != null ? String(args.score.rubric_version) : null,
    input_snapshot: args.audit.inputSnapshot,
    raw_output: args.audit.rawOutput,
    parsed_score: args.score.overall_score,
    rationale: args.score.overall_rationale,
  });

  if (auditError) {
    throw new Error(
      `Failed to save interview score audit: ${auditError.message ?? JSON.stringify(auditError)}`,
    );
  }
}
