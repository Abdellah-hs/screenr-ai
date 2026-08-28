import { createClient } from "@/lib/supabase/server";
import {
  toCandidateStage,
  type ApplicationState,
  type CandidateStage,
  type ScreeningTier,
  type SlaTimer,
} from "@/lib/constants";
import {
  DECISION_QUEUE_STATES,
  type DecisionRow,
} from "@/lib/overview/decision-queue";
import { hasScreeningScore } from "@/lib/candidates/pipeline-summary";

// ─── Active campaigns (lite) ─────────────────────────────────────────────────

export interface CampaignLite {
  id: string;
  title: string;
}

/**
 * The owner's Active, non-deleted campaigns — id + title only. Drives the
 * "Active campaigns" KPI and seeds the expiring-links lookup (which needs the
 * campaign id set to scope on). SELECT-only.
 */
export async function fetchActiveCampaignsLite(userId: string): Promise<CampaignLite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, title")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (error || !data) return [];
  return data as CampaignLite[];
}

// ─── Pipeline stage counts ───────────────────────────────────────────────────

export interface PipelineStageCounts {
  /** One count per coarse `CandidateStage` bucket. */
  buckets: Record<CandidateStage, number>;
  /** Every application across the owner's Active campaigns (all buckets). */
  total: number;
  /**
   * The `rejected` bucket, split by whether anybody actually decided.
   *
   * `toCandidateStage` folds `screening_expired`, `interview_expired`,
   * `interview_no_show`, `processing_failed` and `archived` into `rejected`,
   * so a row labelled "Rejected" was counting people nobody turned down. On
   * this page that contradicted the decision queue outright: the queue names
   * those same people under "Ended without a decision · nobody was rejected"
   * while the rail called them rejected, on one screen. The two numbers always
   * sum back to `buckets.rejected`.
   */
  rejectedOutright: number;
  closedOut: number;
}

function emptyBuckets(): Record<CandidateStage, number> {
  return {
    applied: 0,
    screening: 0,
    interview: 0,
    final_interview: 0,
    hired: 0,
    rejected: 0,
  };
}

const EMPTY_COUNTS: PipelineStageCounts = {
  buckets: emptyBuckets(),
  total: 0,
  rejectedOutright: 0,
  closedOut: 0,
};

/**
 * Applications across the owner's **Active** campaigns, collapsed into the six
 * coarse pipeline buckets (via `toCandidateStage`). Powers the overview funnel
 * and the "in pipeline" KPI. A frozen (draft/paused/closed) campaign is excluded
 * — the home page is a pulse of live hiring. SELECT-only.
 */
export async function fetchPipelineStageCounts(userId: string): Promise<PipelineStageCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("status, campaigns!inner(user_id, status, deleted_at)")
    .eq("campaigns.user_id", userId)
    .eq("campaigns.status", "active")
    .is("campaigns.deleted_at", null);

  if (error || !data) return { ...EMPTY_COUNTS, buckets: emptyBuckets() };

  const buckets = emptyBuckets();
  let rejectedOutright = 0;

  for (const row of data as unknown as Array<{ status: string }>) {
    buckets[toCandidateStage(row.status)] += 1;
    if (row.status === "rejected") rejectedOutright += 1;
  }

  return {
    buckets,
    total: data.length,
    rejectedOutright,
    closedOut: buckets.rejected - rejectedOutright,
  };
}

// ─── Expiring screening links ────────────────────────────────────────────────

export interface ExpiringScreeningLink {
  campaignId: string;
  campaignTitle: string;
  count: number;
}

const DEFAULT_EXPIRY_WINDOW_HOURS = 48;

/**
 * Screening links that are still `sent` (the candidate hasn't completed the
 * call) and fall due within the next `windowHours` — the candidates worth a
 * nudge before the deadline silently expires. Scoped to the owner's Active
 * campaigns and grouped per campaign, most-urgent campaign first.
 *
 * Robust by construction: it resolves the owner's campaign id set first, then
 * filters responses with a single-level embed (`applications.campaign_id IN …`)
 * — no fragile multi-level join filter. `now` is injectable for testability.
 * SELECT-only.
 */
export async function fetchExpiringScreeningLinks(
  userId: string,
  now: Date = new Date(),
  windowHours: number = DEFAULT_EXPIRY_WINDOW_HOURS,
): Promise<ExpiringScreeningLink[]> {
  const campaigns = await fetchActiveCampaignsLite(userId);
  if (campaigns.length === 0) return [];

  const titleById = new Map(campaigns.map((c) => [c.id, c.title]));
  const horizon = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_question_responses")
    .select("expires_at, applications!inner(campaign_id)")
    .eq("status", "sent")
    .not("expires_at", "is", null)
    .gte("expires_at", now.toISOString())
    .lte("expires_at", horizon.toISOString())
    .in(
      "applications.campaign_id",
      campaigns.map((c) => c.id),
    );

  if (error || !data) return [];

  const counts = new Map<string, number>();
  for (const row of data as unknown as Array<{ applications: { campaign_id: string } }>) {
    const campaignId = row.applications.campaign_id;
    counts.set(campaignId, (counts.get(campaignId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([campaignId, count]) => ({
      campaignId,
      campaignTitle: titleById.get(campaignId) ?? "",
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Recent outcomes ─────────────────────────────────────────────────────────

export interface RecentOutcome {
  candidateName: string;
  campaignId: string;
  campaignTitle: string;
  outcome: "hired" | "rejected";
  at: string;
}

/**
 * The owner's most recent terminal decisions (hired / rejected) across all
 * non-deleted campaigns, newest first. A lightweight "recent activity" feed for
 * the overview. SELECT-only.
 */
export async function fetchRecentOutcomes(
  userId: string,
  limit: number = 6,
): Promise<RecentOutcome[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(
      "status, updated_at, campaign_id, candidates!inner(first_name, last_name), campaigns!inner(title, user_id, deleted_at)",
    )
    .in("status", ["hired", "rejected"])
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (
    data as unknown as Array<{
      status: "hired" | "rejected";
      updated_at: string;
      campaign_id: string;
      candidates: { first_name: string | null; last_name: string | null };
      campaigns: { title: string };
    }>
  ).map((row) => ({
    candidateName:
      `${row.candidates.first_name ?? ""} ${row.candidates.last_name ?? ""}`.trim() ||
      "Unnamed candidate",
    campaignId: row.campaign_id,
    campaignTitle: row.campaigns.title,
    outcome: row.status,
    at: row.updated_at,
  }));
}

// ─── Decision queue ──────────────────────────────────────────────────────────

/**
 * Every application across the owner's non-deleted campaigns that is waiting on
 * a **person**, or that lapsed without anybody deciding anything.
 *
 * The bell counts these per campaign; the overview names them, because "4
 * candidates awaiting review" tells a recruiter there is work but not whether
 * it is the work to do first. `campaigns.status` comes back because SLA does
 * not run on a frozen campaign, and the SLA timers are resolved by the caller
 * (they are already loaded per campaign).
 *
 * The two later stage scores are read from the rows that hold them, not from
 * `applications`. `applications.screening_q_score` and
 * `applications.interview_score` are declared in the original pipeline
 * migration and **written by nothing** — the screening score lands on
 * `screening_question_responses.overall_score` and the interview score inside
 * `interview_sessions.scores`. Selecting the dead columns meant every row of
 * the group headed "Scored" arrived with a null score. Both embeds are
 * `UNIQUE(application_id)`, so PostgREST returns one object or null rather than
 * an array. SELECT-only.
 */
export async function fetchDecisionQueueRows(userId: string): Promise<DecisionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(`
      id,
      campaign_id,
      status,
      updated_at,
      resume_score,
      screening_tier,
      candidates!inner (
        first_name,
        last_name
      ),
      campaigns!inner (
        title,
        status,
        user_id,
        deleted_at
      ),
      screening_question_responses (
        overall_score,
        status
      ),
      interview_sessions (
        scores
      )
    `)
    .in("status", [...DECISION_QUEUE_STATES])
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return [];

  return (
    data as unknown as Array<{
      id: string;
      campaign_id: string;
      status: ApplicationState;
      updated_at: string | null;
      resume_score: number | null;
      screening_tier: ScreeningTier | null;
      candidates: { first_name: string | null; last_name: string | null };
      campaigns: { title: string; status: string };
      screening_question_responses: {
        overall_score: number | null;
        status: string | null;
      } | null;
      interview_sessions: { scores: { overall_score?: number | null } | null } | null;
    }>
  ).map((row) => {
    const screening = row.screening_question_responses;
    const interviewScore = row.interview_sessions?.scores?.overall_score;

    return {
      applicationId: row.id,
      campaignId: row.campaign_id,
      campaignTitle: row.campaigns.title,
      campaignStatus: row.campaigns.status,
      candidateName:
        `${row.candidates.first_name ?? ""} ${row.candidates.last_name ?? ""}`.trim() ||
        "Unnamed candidate",
      status: row.status,
      updatedAt: row.updated_at ?? new Date().toISOString(),
      resumeScore: row.resume_score,
      resumeTier: row.screening_tier,
      // The same predicate the candidate table scores on, so a number cannot
      // appear here while that list still calls the response unscored.
      screeningScore: hasScreeningScore(screening) ? Number(screening.overall_score) : null,
      interviewScore: interviewScore ?? null,
    };
  });
}

/**
 * The SLA timers and status of every non-deleted campaign the owner has, keyed
 * by campaign id — what `toDecisionItem` needs to judge lateness. SELECT-only.
 */
export async function fetchCampaignSlaContext(
  userId: string,
): Promise<Record<string, SlaTimer[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sla_timers")
    .select(
      "campaign_id, stage, time_limit_hours, alert_threshold_hours, escalation_threshold_hours, campaigns!inner(user_id, deleted_at)",
    )
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return {};

  const byCampaign: Record<string, SlaTimer[]> = {};
  for (const row of data as unknown as Array<
    { campaign_id: string } & SlaTimer
  >) {
    (byCampaign[row.campaign_id] ??= []).push({
      stage: row.stage,
      time_limit_hours: row.time_limit_hours,
      alert_threshold_hours: row.alert_threshold_hours,
      escalation_threshold_hours: row.escalation_threshold_hours,
    });
  }
  return byCampaign;
}
