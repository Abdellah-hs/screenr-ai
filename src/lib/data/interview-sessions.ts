import { createClient } from "@/lib/supabase/server";
import type { SupabaseDb } from "@/lib/supabase/types";

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

export interface InterviewSessionRow {
  id: string;
  application_id: string;
  status: InterviewSessionStatus;
  transcript: InterviewTranscriptTurn[];
  recording_url: string | null;
  scores: unknown | null;
  proctoring: unknown | null;
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
