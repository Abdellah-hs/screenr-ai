import { createClient } from "@/lib/supabase/server";
import { toCandidateStage, type CandidateStage } from "@/lib/constants";

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

  if (error || !data) return { buckets: emptyBuckets(), total: 0 };

  const buckets = emptyBuckets();
  for (const row of data as unknown as Array<{ status: string }>) {
    buckets[toCandidateStage(row.status)] += 1;
  }
  return { buckets, total: data.length };
}

// ─── Hired count ─────────────────────────────────────────────────────────────

/**
 * All-time hires across the owner's non-deleted campaigns (includes campaigns
 * that have since been closed — a hire still counts). KPI tile. SELECT-only.
 */
export async function fetchHiredCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("applications")
    .select("id, campaigns!inner(user_id, deleted_at)", { count: "exact", head: true })
    .eq("status", "hired")
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error) return 0;
  return count ?? 0;
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
