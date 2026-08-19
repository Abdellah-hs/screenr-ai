"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  addToTalentPoolSchema,
  updateTalentPoolEntrySchema,
  uuidSchema,
} from "@/lib/validations";
import { fetchCandidateById } from "@/lib/data/candidates";
import {
  deleteTalentPoolEntry,
  fetchPooledCandidateEvidence,
  fetchPooledCandidateIds,
  fetchTalentPoolEntries,
  fetchTalentPoolEntryByCandidate,
  updateTalentPoolEntry as updateTalentPoolEntryRow,
  upsertTalentPoolEntry,
} from "@/lib/data/talent-pool-entries";
import { composeTalentPoolEntries } from "@/lib/talent-pool/compose";
import { normalizePoolTags } from "@/lib/talent-pool/search";
import type { TalentPoolEntry } from "@/lib/constants";

/**
 * The curated pool (PRD 3.11) — people a recruiter deliberately marked as worth
 * revisiting, as opposed to the automatic directory of everyone who ever
 * applied that `getTalentPool` returns.
 *
 * Two queries rather than one join because the evidence a pool search runs over
 * (scores, campaigns, parsed resumes) hangs off applications, not off the
 * entry, and one person can have several. Composition is pure and tested
 * separately; this action only supplies it with rows.
 */
export async function getCuratedTalentPool(): Promise<TalentPoolEntry[]> {
  const userId = await requireUserId();

  const entries = await fetchTalentPoolEntries(userId);
  if (entries.length === 0) return [];

  const evidence = await fetchPooledCandidateEvidence(
    userId,
    [...new Set(entries.map((e) => e.candidate_id))],
  );

  return composeTalentPoolEntries(entries, evidence);
}

/** Candidate ids already pooled — lets the directory mark who is in the pool. */
export async function getPooledCandidateIds(): Promise<string[]> {
  const userId = await requireUserId();
  return fetchPooledCandidateIds(userId);
}

export interface CandidatePoolState {
  pooled: boolean;
  entryId: string | null;
  tags: string[];
  notes: string;
}

/**
 * Whether this application's candidate is in the recruiter's pool, and with
 * what curation — so the candidate page can open its editor pre-filled rather
 * than blank, and never offer "add" for someone already there.
 */
export async function getCandidatePoolState(
  applicationId: string,
): Promise<CandidatePoolState> {
  const userId = await requireUserId();
  const empty: CandidatePoolState = { pooled: false, entryId: null, tags: [], notes: "" };

  if (!uuidSchema.safeParse(applicationId).success) return empty;

  const application = await fetchCandidateById(applicationId, userId);
  if (!application) return empty;

  const entry = await fetchTalentPoolEntryByCandidate(userId, application.candidate_id);
  if (!entry) return empty;

  return {
    pooled: true,
    entryId: entry.id,
    tags: entry.tags,
    notes: entry.notes ?? "",
  };
}

/**
 * Mark a candidate as a silver medalist.
 *
 * Ownership is checked through `fetchCandidateById`, which is scoped to the
 * recruiter's campaigns and throws on a campaign that is not theirs — so a
 * crafted application id cannot be used to pool a stranger. The database
 * repeats the check in the INSERT policy; neither layer is load-bearing alone.
 */
export async function addToTalentPool(input: {
  applicationId: string;
  tags?: string[];
  notes?: string;
}): Promise<{ entryId: string }> {
  const userId = await requireUserId();

  const parsed = addToTalentPoolSchema.parse(input);

  checkRateLimit(userId, {
    name: "talent-pool-add",
    maxRequests: 60,
    windowMs: 5 * 60 * 1000,
  });

  const application = await fetchCandidateById(parsed.applicationId, userId);
  if (!application) throw new Error("Application not found");

  const { id } = await upsertTalentPoolEntry(userId, {
    candidateId: application.candidate_id,
    sourceApplicationId: parsed.applicationId,
    sourceCampaignId: application.campaign_id,
    tags: normalizePoolTags(parsed.tags),
    notes: parsed.notes.length > 0 ? parsed.notes : null,
  });

  revalidatePath("/candidates");
  revalidatePath(
    `/campaigns/${application.campaign_id}/candidates/${parsed.applicationId}`,
  );

  return { entryId: id };
}

/** Edit the tags and note on an existing entry. */
export async function updateTalentPoolCuration(input: {
  entryId: string;
  tags?: string[];
  notes?: string;
}): Promise<void> {
  const userId = await requireUserId();

  const parsed = updateTalentPoolEntrySchema.parse(input);

  checkRateLimit(userId, {
    name: "talent-pool-update",
    maxRequests: 60,
    windowMs: 5 * 60 * 1000,
  });

  await updateTalentPoolEntryRow(userId, parsed.entryId, {
    tags: normalizePoolTags(parsed.tags),
    notes: parsed.notes.length > 0 ? parsed.notes : null,
  });

  revalidatePath("/candidates");
}

/**
 * Remove someone from the pool.
 *
 * A hard delete, not a soft one: the pool is a live shortlist the recruiter
 * curates, and un-marking someone is them saying "I was wrong about this",
 * not a pipeline decision anyone needs to audit later. Their applications,
 * scores and transition history — the things that are evidence — are untouched.
 */
export async function removeFromTalentPool(entryId: string): Promise<void> {
  const userId = await requireUserId();

  const parsed = uuidSchema.parse(entryId);

  checkRateLimit(userId, {
    name: "talent-pool-remove",
    maxRequests: 60,
    windowMs: 5 * 60 * 1000,
  });

  await deleteTalentPoolEntry(userId, parsed);

  revalidatePath("/candidates");
}
