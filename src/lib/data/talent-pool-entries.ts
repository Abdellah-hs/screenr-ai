import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import { hasScreeningScore } from "@/lib/candidates/pipeline-summary";

type EntryRow = Database["public"]["Tables"]["talent_pool_entries"]["Row"];
type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];

/**
 * A curated pool entry with the person it points at, and the campaign it was
 * created from where that campaign still exists.
 */
export type TalentPoolEntryRow = Pick<
  EntryRow,
  | "id"
  | "candidate_id"
  | "source_application_id"
  | "source_campaign_id"
  | "tags"
  | "notes"
  | "added_at"
> & {
  candidates: Pick<
    CandidateRow,
    "id" | "first_name" | "last_name" | "email" | "phone" | "location"
  >;
  campaigns: { id: string; title: string } | null;
};

/**
 * The applications belonging to pooled people, carrying the evidence the pool's
 * search runs over: the scores behind the range filter, the campaign behind the
 * origin filter, and the parsed resume behind the skills query.
 */
export interface PooledCandidateEvidenceRow {
  candidate_id: string;
  campaign_id: string;
  created_at: string;
  resume_score: number | null;
  /**
   * The screening and interview readings, resolved here from the rows that
   * hold them so `composeTalentPoolEntries` stays a pure function over flat
   * numbers.
   *
   * They used to be read straight off `applications.screening_q_score` and
   * `applications.interview_score`, which nothing has ever written — so
   * `bestScore` was silently the resume score alone, and somebody who scored
   * 45 on their CV and 88 at interview was excluded from a "80-100" search by
   * the one filter meant to find them.
   */
  screening_score: number | null;
  interview_score: number | null;
  parsed_data: unknown;
  campaigns: { id: string; title: string };
}

const ENTRY_SELECT = `
  id,
  candidate_id,
  source_application_id,
  source_campaign_id,
  tags,
  notes,
  added_at,
  candidates!inner (
    id, first_name, last_name, email, phone, location
  ),
  campaigns (
    id, title
  )
`;

/**
 * Every entry in this recruiter's curated pool, newest first.
 *
 * `campaigns` is a LEFT join — the source campaign may have been hard-deleted,
 * which nulls the reference. That must not drop the entry: the pool exists
 * precisely so that people outlive the roles they applied to.
 *
 * `candidates` is an INNER join because an entry without a person is
 * meaningless, and the candidate FK cascades, so it cannot happen.
 */
export async function fetchTalentPoolEntries(
  userId: string,
): Promise<TalentPoolEntryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("talent_pool_entries")
    .select(ENTRY_SELECT)
    .eq("added_by", userId)
    .order("added_at", { ascending: false });

  if (error) {
    console.error("fetchTalentPoolEntries failed:", error);
    throw new Error(`Failed to load talent pool: ${error.message}`);
  }

  return (data ?? []) as unknown as TalentPoolEntryRow[];
}

/**
 * Scores, campaigns and parsed resumes for the given pooled candidates.
 *
 * Kept out of `fetchTalentPoolEntries` because `parsed_data` is a large JSON
 * blob per application, and out of the directory's `fetchTalentPoolRows` for
 * the same reason — that page never reads it.
 *
 * Scoped by `campaigns.user_id`: a pooled person may since have applied to
 * someone else's campaign, and that history is not this recruiter's to see.
 */
export async function fetchPooledCandidateEvidence(
  userId: string,
  candidateIds: string[],
): Promise<PooledCandidateEvidenceRow[]> {
  if (candidateIds.length === 0) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      `
      candidate_id,
      campaign_id,
      created_at,
      resume_score,
      parsed_data,
      campaigns!inner ( id, title, user_id ),
      screening_question_responses ( overall_score, status ),
      interview_sessions ( scores )
    `,
    )
    .in("candidate_id", candidateIds)
    .eq("campaigns.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchPooledCandidateEvidence failed:", error);
    throw new Error(`Failed to load talent pool evidence: ${error.message}`);
  }

  return (
    (data ?? []) as unknown as Array<
      Omit<PooledCandidateEvidenceRow, "screening_score" | "interview_score"> & {
        screening_question_responses: {
          overall_score: number | null;
          status: string | null;
        } | null;
        interview_sessions: { scores: { overall_score?: number | null } | null } | null;
      }
    >
  ).map(({ screening_question_responses, interview_sessions, ...row }) => ({
    ...row,
    // The same predicate the candidate table scores on, so a number cannot
    // reach the pool's search while that list still calls the response unscored.
    screening_score: hasScreeningScore(screening_question_responses)
      ? Number(screening_question_responses.overall_score)
      : null,
    interview_score: interview_sessions?.scores?.overall_score ?? null,
  }));
}

/** Candidate ids already in this recruiter's pool — drives the "Pooled" badge. */
/** The recruiter's pool entry for one candidate, or null if not pooled. */
export async function fetchTalentPoolEntryByCandidate(
  userId: string,
  candidateId: string,
): Promise<Pick<EntryRow, "id" | "tags" | "notes" | "added_at"> | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("talent_pool_entries")
    .select("id, tags, notes, added_at")
    .eq("added_by", userId)
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (error) {
    console.error("fetchTalentPoolEntryByCandidate failed:", error);
    return null;
  }

  return data;
}

export interface InsertTalentPoolEntryInput {
  candidateId: string;
  sourceApplicationId: string | null;
  sourceCampaignId: string | null;
  tags: string[];
  notes: string | null;
}

/**
 * Add a person to the recruiter's pool.
 *
 * `upsert` on the (added_by, candidate_id) unique key rather than a plain
 * insert: pooling someone already pooled is a recruiter repeating themselves
 * from a different campaign, not an error worth showing them. The later tags
 * and note win, and `source_*` is refreshed to the campaign they were standing
 * in — the most recent reason to keep this person is the more useful one.
 */
export async function upsertTalentPoolEntry(
  userId: string,
  input: InsertTalentPoolEntryInput,
): Promise<{ id: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("talent_pool_entries")
    .upsert(
      {
        added_by: userId,
        candidate_id: input.candidateId,
        source_application_id: input.sourceApplicationId,
        source_campaign_id: input.sourceCampaignId,
        tags: input.tags,
        notes: input.notes,
      },
      { onConflict: "added_by,candidate_id" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("upsertTalentPoolEntry failed:", error);
    throw new Error(`Failed to add to talent pool: ${error.message}`);
  }

  return { id: data.id };
}

/**
 * Update the curation on an existing entry. Scoped by `added_by` in addition to
 * RLS — belt and braces, and it makes the intent readable at the call site.
 */
export async function updateTalentPoolEntry(
  userId: string,
  entryId: string,
  fields: { tags: string[]; notes: string | null },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("talent_pool_entries")
    .update({ tags: fields.tags, notes: fields.notes })
    .eq("id", entryId)
    .eq("added_by", userId);

  if (error) {
    console.error("updateTalentPoolEntry failed:", error);
    throw new Error(`Failed to update talent pool entry: ${error.message}`);
  }
}

export async function deleteTalentPoolEntry(
  userId: string,
  entryId: string,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("talent_pool_entries")
    .delete()
    .eq("id", entryId)
    .eq("added_by", userId);

  if (error) {
    console.error("deleteTalentPoolEntry failed:", error);
    throw new Error(`Failed to remove from talent pool: ${error.message}`);
  }
}
