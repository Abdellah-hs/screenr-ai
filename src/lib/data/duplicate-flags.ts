import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database.types";
import type { SupabaseDb } from "@/lib/supabase/types";

type DuplicateFlagRow = Database["public"]["Tables"]["duplicate_review_queue"]["Row"];
type DuplicateFlagInsert = Database["public"]["Tables"]["duplicate_review_queue"]["Insert"];
type DuplicateFlagUpdate = Database["public"]["Tables"]["duplicate_review_queue"]["Update"];

export type MatchSignals = {
  email_match?: boolean;
  phone_match?: boolean;
  matched_email?: string;
  matched_phone?: string | null;
};

export type DuplicateFlagStatus = "open" | "approved" | "rejected";

export interface DuplicateFlag {
  id: string;
  candidate_id: string;
  matched_candidate_id: string;
  match_signals: MatchSignals;
  status: DuplicateFlagStatus;
  reviewer_user_id: string | null;
  rationale: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function toDuplicateFlag(row: DuplicateFlagRow): DuplicateFlag {
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    matched_candidate_id: row.matched_candidate_id,
    match_signals: (row.match_signals as MatchSignals | null) ?? {},
    status: row.status as DuplicateFlagStatus,
    reviewer_user_id: row.reviewer_user_id,
    rationale: row.rationale,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
  };
}

/**
 * Find an existing candidate by exact email match. Returns the earliest live
 * (non-soft-deleted) match. Uses limit(1)+maybeSingle rather than single() so a
 * pre-existing duplicate (two candidates already share this email) doesn't make
 * the lookup error out — which would silently stop flagging every later
 * applicant with that email. Merged-away candidates (deleted_at set) are skipped
 * so we never flag against a dead record.
 */
export async function findCandidateByEmail(
  email: string,
  db?: SupabaseDb,
): Promise<{ id: string } | null> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from("candidates")
    .select("id")
    .eq("email", email)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Find an existing candidate by exact phone match (non-null phone only). Same
 * earliest-live-match semantics as findCandidateByEmail — tolerant of
 * pre-existing duplicates and skips soft-deleted records.
 */
export async function findCandidateByPhone(
  phone: string,
  db?: SupabaseDb,
): Promise<{ id: string } | null> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from("candidates")
    .select("id")
    .eq("phone", phone)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Insert a duplicate flag row so HR can review the match.
 */
export async function flagDuplicateCandidate(
  params: {
    candidateId: string;
    matchedCandidateId: string;
    matchSignals: MatchSignals;
  },
  db?: SupabaseDb,
): Promise<string> {
  const supabase = db ?? (await createClient());

  const insert: DuplicateFlagInsert = {
    candidate_id: params.candidateId,
    matched_candidate_id: params.matchedCandidateId,
    match_signals: params.matchSignals as Json,
    status: "open",
  };

  const { data, error } = await supabase
    .from("duplicate_review_queue")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to flag duplicate candidate: ${error?.message ?? "unknown error"}`);
  }

  return data.id;
}

/**
 * Fetch all duplicate flags, ordered by newest first.
 */
export async function fetchDuplicateFlags(): Promise<DuplicateFlag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duplicate_review_queue")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchDuplicateFlags failed:", error);
    throw new Error(`Failed to fetch duplicate flags: ${error.message}`);
  }

  return (data || []).map((r) => toDuplicateFlag(r as DuplicateFlagRow));
}

/**
 * Fetch a single duplicate flag by id.
 */
export async function fetchDuplicateFlagById(id: string): Promise<DuplicateFlag | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duplicate_review_queue")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return toDuplicateFlag(data as DuplicateFlagRow);
}

/**
 * Resolve a duplicate flag.
 *
 * - "approved"  → the new candidate is considered a duplicate of the matched one.
 *                 The caller is expected to run the merge logic (e.g. re-point
 *                 applications) after this returns.
 * - "rejected"  → the new candidate is kept separate; no merge happens.
 *
 * Rationale is required per the ATS state-machine override rules.
 */
export async function resolveDuplicateFlag(params: {
  flagId: string;
  decision: "approved" | "rejected";
  reviewerUserId: string;
  rationale: string;
}): Promise<void> {
  const supabase = await createClient();

  const update: DuplicateFlagUpdate = {
    status: params.decision,
    reviewer_user_id: params.reviewerUserId,
    rationale: params.rationale,
    resolved_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("duplicate_review_queue")
    .update(update)
    .eq("id", params.flagId);

  if (error) {
    throw new Error(`Failed to resolve duplicate flag: ${error.message}`);
  }
}

export interface DuplicateCandidateSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  created_at: string;
}

export interface DuplicateReviewItem {
  flag: DuplicateFlag;
  /** The newly-ingested record — soft-deleted if the flag is approved. */
  candidate: DuplicateCandidateSummary;
  /** The pre-existing record the new one matched — kept on approval. */
  matched: DuplicateCandidateSummary;
}

/**
 * The HR review queue: every open duplicate flag, each enriched with both
 * candidates' details so the page can show them side by side. Two separate
 * queries (flags, then candidates) stitched in memory — avoids the awkward
 * PostgREST embed of two FKs pointing at the same table.
 *
 * **The candidate read runs on the admin client, and it has to.** The flag list
 * is global by policy (`duplicate_review_queue` SELECT is `USING (true)`), but
 * `candidates` SELECT requires the row to have an application in one of the
 * reader's campaigns. Reading the pair with the session client therefore
 * silently dropped any flag whose candidate failed that predicate — and the
 * predicate has nothing to do with whether the flag is reviewable. A candidate
 * orphaned by a campaign delete (`applications.campaign_id` is ON DELETE
 * CASCADE, so the applications go and the candidate row stays) is invisible to
 * every recruiter forever, so every flag naming it vanished from the queue with
 * no error and no count. On this database that hid 44 of 47 open flags behind
 * "the queue is clear".
 *
 * This does not widen what the queue exposes so much as make it work: the flag
 * row is already globally readable and already carries the matched email and
 * phone in `match_signals`. If the queue is ever scoped per owner, scope the
 * FLAG policy — do not reintroduce a tenancy filter as a side effect of an
 * enrichment join, which is what this was.
 */
export async function fetchOpenDuplicateFlagsWithCandidates(): Promise<
  DuplicateReviewItem[]
> {
  const supabase = await createClient();

  const { data: flagRows, error: flagError } = await supabase
    .from("duplicate_review_queue")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (flagError) {
    throw new Error(`Failed to fetch duplicate review queue: ${flagError.message}`);
  }

  const flags = (flagRows || []).map((r) => toDuplicateFlag(r as DuplicateFlagRow));
  if (flags.length === 0) return [];

  const candidateIds = Array.from(
    new Set(flags.flatMap((f) => [f.candidate_id, f.matched_candidate_id])),
  );

  const { data: candRows, error: candError } = await createAdminClient()
    .from("candidates")
    .select("id, first_name, last_name, email, phone, created_at")
    .in("id", candidateIds);

  if (candError) {
    throw new Error(
      `Failed to fetch candidates for review queue: ${candError.message}`,
    );
  }

  const byId = new Map<string, DuplicateCandidateSummary>();
  for (const c of candRows || []) {
    byId.set(c.id, {
      id: c.id,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email,
      email: c.email,
      phone: c.phone,
      created_at: c.created_at,
    });
  }

  const items: DuplicateReviewItem[] = [];
  const unresolvable: string[] = [];
  for (const flag of flags) {
    const candidate = byId.get(flag.candidate_id);
    const matched = byId.get(flag.matched_candidate_id);
    if (!candidate || !matched) {
      // Both FKs are ON DELETE CASCADE, so a hard-deleted candidate takes its
      // flags with it and this should be unreachable. It is logged rather than
      // swallowed because a queue that quietly shrinks is the failure this
      // function just came back from.
      unresolvable.push(flag.id);
      continue;
    }
    items.push({ flag, candidate, matched });
  }

  if (unresolvable.length > 0) {
    console.error(
      `fetchOpenDuplicateFlagsWithCandidates: ${unresolvable.length} open flag(s) reference a candidate row that no longer exists and were omitted from the queue:`,
      unresolvable,
    );
  }

  return items;
}

/**
 * Merge two candidates: re-point all applications from `sourceCandidateId`
 * to `targetCandidateId`, then soft-delete the source candidate.
 *
 * This is a data-layer helper; the action layer must verify auth and
 * ensure the flag was approved before calling it.
 *
 * **The re-point runs on the session client and the soft-delete cannot.** The
 * two steps are ordered — applications first, so a failure leaves the flag open
 * and retryable — and step one destroys the row-level predicate step two needs.
 * `candidates` UPDATE is `USING (EXISTS applications a JOIN campaigns c … WHERE
 * a.candidate_id = candidates.id AND c.user_id = auth.uid())`, so once the
 * source has no applications left it matches no policy row. Postgres does not
 * error on that: the UPDATE simply touches **0 rows** and returns success. The
 * merge then reported done while the source candidate stayed live — still
 * winning `findCandidateByEmail` (which only skips `deleted_at` rows), so every
 * later applicant on that email flagged against a record HR had already merged
 * away.
 *
 * The re-point keeps the session client deliberately: that is the check that
 * actually authorises the merge (you may only move applications in campaigns you
 * own). Only the soft-delete escalates, and it verifies it hit a row.
 */
export async function mergeCandidatesTx(
  sourceCandidateId: string,
  targetCandidateId: string
): Promise<void> {
  const supabase = await createClient();

  // Re-point applications
  const { error: appError } = await supabase
    .from("applications")
    .update({ candidate_id: targetCandidateId, updated_at: new Date().toISOString() })
    .eq("candidate_id", sourceCandidateId);

  if (appError) {
    throw new Error(`Failed to re-point applications: ${appError.message}`);
  }

  // Soft-delete source candidate. `.select("id")` is what makes a 0-row update
  // observable — without it a silently filtered write is indistinguishable from
  // a successful one.
  const { data: deleted, error: delError } = await createAdminClient()
    .from("candidates")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sourceCandidateId)
    .select("id");

  if (delError) {
    throw new Error(`Failed to soft-delete source candidate: ${delError.message}`);
  }

  // Re-stamping an already-deleted source is harmless, so this only fires when
  // the row itself is unreachable — which would leave a live duplicate behind.
  if (!deleted || deleted.length === 0) {
    throw new Error(
      `Merge left candidate ${sourceCandidateId} live: its applications moved to ${targetCandidateId} but the soft-delete matched no row. The flag stays open so this can be retried.`,
    );
  }
}
