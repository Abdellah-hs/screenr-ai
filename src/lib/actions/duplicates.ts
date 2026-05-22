"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveDuplicateSchema } from "@/lib/validations";
import {
  fetchOpenDuplicateFlagsWithCandidates,
  fetchDuplicateFlagById,
  resolveDuplicateFlag,
  mergeCandidatesTx,
  type DuplicateReviewItem,
} from "@/lib/data/duplicate-flags";

/**
 * The HR duplicate review queue — every open flag, each with both
 * candidates' details. Auth-guarded; any authenticated user (HR) may review.
 */
export async function getDuplicateReviewQueue(): Promise<DuplicateReviewItem[]> {
  await requireUserId();
  return fetchOpenDuplicateFlagsWithCandidates();
}

export interface ResolveDuplicateInput {
  flagId: string;
  decision: "approved" | "rejected";
  rationale: string;
}

/**
 * Resolve a flagged duplicate.
 *
 * - approved → the newly-ingested candidate is a duplicate: its applications
 *   re-point onto the pre-existing record and it is soft-deleted, then the
 *   flag is marked approved. The merge runs first so a merge failure leaves
 *   the flag open and retryable.
 * - rejected → the records are kept separate; the flag is marked rejected.
 */
export async function resolveDuplicateFlagAction(
  input: ResolveDuplicateInput,
): Promise<{ success: true; decision: "approved" | "rejected" }> {
  const userId = await requireUserId();
  const parsed = resolveDuplicateSchema.parse(input);

  checkRateLimit(userId, {
    name: "resolve-duplicate",
    maxRequests: 30,
    windowMs: 5 * 60 * 1000,
  });

  // Preflight: only an still-open flag can be resolved. Guards against a
  // double-resolve from a stale queue page.
  const flag = await fetchDuplicateFlagById(parsed.flagId);
  if (!flag) throw new Error("Duplicate flag not found");
  if (flag.status !== "open") {
    throw new Error("This duplicate has already been reviewed");
  }

  if (parsed.decision === "approved") {
    // Merge the newly-ingested candidate into the pre-existing record.
    await mergeCandidatesTx(flag.candidate_id, flag.matched_candidate_id);
  }

  await resolveDuplicateFlag({
    flagId: parsed.flagId,
    decision: parsed.decision,
    reviewerUserId: userId,
    rationale: parsed.rationale,
  });

  revalidatePath("/admin/duplicates");
  return { success: true, decision: parsed.decision };
}
