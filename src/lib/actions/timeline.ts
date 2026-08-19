"use server";

import { requireUserId } from "@/lib/auth/guards";
import { uuidSchema } from "@/lib/validations";
import { fetchCandidateById } from "@/lib/data/candidates";
import { fetchApplicationTimeline } from "@/lib/data/transitions";
import {
  buildActivityTimeline,
  type ActivityTimeline,
} from "@/lib/rules/transition-timeline";

const EMPTY: ActivityTimeline = { entries: [], hoursInCurrentState: null };

/**
 * The full history of one application (PRD 3.6.3), with overrides paired to the
 * automated decisions they reversed (PRD 3.7.2).
 *
 * `application_transitions` has been complete and append-only since #28 and
 * nothing ever read it — this is a rendering gap, not new data. The rule layer
 * decides what the rows mean; this only guards and fetches.
 *
 * Ownership goes through `fetchCandidateById`, which is scoped to the
 * recruiter's campaigns and throws on someone else's. RLS on
 * `application_transitions` repeats the check independently.
 */
export async function getCandidateTimeline(
  applicationId: string,
): Promise<ActivityTimeline> {
  const userId = await requireUserId();

  // A malformed id resolves to an empty history rather than an error: the
  // timeline is one panel on a page, and a bad id already 404s upstream.
  if (!uuidSchema.safeParse(applicationId).success) return EMPTY;

  const application = await fetchCandidateById(applicationId, userId);
  if (!application) return EMPTY;

  const rows = await fetchApplicationTimeline(applicationId);

  return buildActivityTimeline(rows);
}
