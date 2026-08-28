import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import type { InterviewScoreLike } from "@/lib/candidates/detail-header";

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];

/** The scored-screening embed, shaped like the one in the campaign candidate query. */
type ScreeningResponseScoreRow = Pick<
  Database["public"]["Tables"]["screening_question_responses"]["Row"],
  "overall_score" | "overall_rationale" | "scored_at" | "rubric_version" | "status"
>;

/**
 * One application row for the Talent Pool, carrying just enough of the owning
 * campaign to (a) label where the candidate came from and (b) show whether that
 * campaign has since been removed. Picks straight off ApplicationRow so the raw
 * row stays compatible with the existing score-array builders in the action.
 */
export type TalentPoolRow = Pick<
  ApplicationRow,
  | "id"
  | "campaign_id"
  | "candidate_id"
  | "status"
  | "resume_score"
  | "screening_tier"
  | "score_rationale"
  | "score_factors"
  | "resume_evaluation"
  | "scored_at"
  | "rubric_version"
  | "created_at"
  | "updated_at"
> & {
  candidates: Pick<
    CandidateRow,
    "id" | "first_name" | "last_name" | "email" | "phone" | "location" | "created_at"
  >;
  campaigns: Pick<CampaignRow, "id" | "title" | "status" | "deleted_at">;
  screening_question_responses:
    | ScreeningResponseScoreRow
    | ScreeningResponseScoreRow[]
    | null;
  /**
   * The interview score, which lives on the session rather than the
   * application. `buildScoresArray` only ever emits `resume` and `screening`,
   * so without this the directory showed no number at all for somebody sitting
   * at the interview stage — the candidate detail page solved the same gap
   * with `withInterviewScore`.
   */
  interview_sessions: { scores: InterviewScoreLike | null } | null;
};

/**
 * Every application belonging to the recruiter's campaigns, with its candidate
 * and owning campaign embedded — the raw feed the Talent Pool groups by person.
 *
 * Scoping is done by RLS (an application/candidate is visible only when its
 * campaign is `user_id = auth.uid()`), and the explicit `campaigns.user_id`
 * filter mirrors that intent. Crucially, NOTHING here filters the campaign's
 * `deleted_at`: a person whose only campaign has been soft-removed must still
 * surface (that is the whole reason the Talent Pool exists) — the removed
 * campaign is flagged for the UI instead of hiding the person.
 *
 * Merged-away duplicate candidate records (`candidates.deleted_at` set) ARE
 * excluded, matching how the duplicate-review flow treats them.
 */
export async function fetchTalentPoolRows(userId: string): Promise<TalentPoolRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      `
      id,
      campaign_id,
      candidate_id,
      status,
      resume_score,
      screening_tier,
      score_rationale,
      score_factors,
      resume_evaluation,
      scored_at,
      rubric_version,
      created_at,
      updated_at,
      candidates!inner (
        id, first_name, last_name, email, phone, location, created_at
      ),
      campaigns!inner (
        id, title, status, deleted_at
      ),
      screening_question_responses (
        overall_score, overall_rationale, scored_at, rubric_version, status
      ),
      interview_sessions (
        scores
      )
    `,
    )
    .eq("campaigns.user_id", userId)
    .is("candidates.deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchTalentPoolRows failed:", error);
    throw new Error(`Failed to fetch talent pool: ${error.message}`);
  }

  return (data ?? []) as unknown as TalentPoolRow[];
}
