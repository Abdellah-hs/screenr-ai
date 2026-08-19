import { createClient } from "@/lib/supabase/server";
import { toCandidateStage, SLA_STAGES, type SlaStage, type SlaTimer } from "@/lib/constants";
import {
  applicationSlaStatus,
  slaStageFor,
  type SlaBreachLevel,
} from "@/lib/rules/sla";

export interface PendingReviewNotification {
  campaign_id: string;
  campaign_title: string;
  pending_review_count: number;
}

export interface SlaBreachNotification {
  campaign_id: string;
  campaign_title: string;
  stage: SlaStage;
  stage_label: string;
  level: SlaBreachLevel;
  count: number;
}

export interface ExpiredInterviewNotification {
  campaign_id: string;
  campaign_title: string;
  expired_count: number;
}

export interface AwaitingDecisionNotification {
  campaign_id: string;
  campaign_title: string;
  awaiting_count: number;
}

/** Unified bell view-model — pending reviews and SLA breaches share one list. */
export interface RecruiterNotification {
  /** Stable per (kind, campaign, stage) so a single item can be dismissed. */
  id: string;
  kind: "pending_review" | "sla_breach" | "interview_expired" | "awaiting_decision";
  campaignId: string;
  campaignTitle: string;
  count: number;
  /** SLA only. */
  stage?: SlaStage;
  stageLabel?: string;
  level?: SlaBreachLevel;
}

/**
 * Campaigns owned by `userId` with applications sitting in
 * `screening_review_pending` — the human-in-the-loop reviews waiting on the
 * recruiter. `screening_review_pending` is only ever reached in HITL mode, so a
 * count of it is exactly "candidates awaiting your review". Grouped to one row
 * per campaign, busiest first. Drives the notification bell. SELECT-only.
 */
export async function fetchPendingReviewNotifications(
  userId: string,
): Promise<PendingReviewNotification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("campaign_id, campaigns!inner(title, user_id, deleted_at)")
    .eq("status", "screening_review_pending")
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return [];

  const byCampaign = new Map<string, { title: string; count: number }>();
  for (const row of data as unknown as Array<{
    campaign_id: string;
    campaigns: { title: string };
  }>) {
    const existing = byCampaign.get(row.campaign_id);
    if (existing) existing.count += 1;
    else byCampaign.set(row.campaign_id, { title: row.campaigns.title, count: 1 });
  }

  return [...byCampaign.entries()]
    .map(([campaign_id, v]) => ({
      campaign_id,
      campaign_title: v.title,
      pending_review_count: v.count,
    }))
    .sort((a, b) => b.pending_review_count - a.pending_review_count);
}

/**
 * Campaigns owned by `userId` with applications in `interview_expired` — AI
 * interviews the candidate was invited to and never completed.
 *
 * Without this the expiry is invisible: the sweep quietly moves an application
 * out of the active funnel and nothing tells the recruiter their candidate
 * lapsed. It's the one pipeline exit that happens with no human in the loop at
 * all, so it's the one most worth surfacing. Grouped to one row per campaign,
 * busiest first. SELECT-only.
 */
export async function fetchExpiredInterviewNotifications(
  userId: string,
): Promise<ExpiredInterviewNotification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("campaign_id, campaigns!inner(title, user_id, deleted_at)")
    .eq("status", "interview_expired")
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return [];

  const byCampaign = new Map<string, { title: string; count: number }>();
  for (const row of data as unknown as Array<{
    campaign_id: string;
    campaigns: { title: string };
  }>) {
    const existing = byCampaign.get(row.campaign_id);
    if (existing) existing.count += 1;
    else byCampaign.set(row.campaign_id, { title: row.campaigns.title, count: 1 });
  }

  return [...byCampaign.entries()]
    .map(([campaign_id, v]) => ({
      campaign_id,
      campaign_title: v.title,
      expired_count: v.count,
    }))
    .sort((a, b) => b.expired_count - a.expired_count);
}

/**
 * The post-interview states where an application is waiting on a **person**:
 * `interview_scored` (HITL — the recruiter must advance it) and `manager_review`
 * (a manager owes a decision).
 *
 * Both are surfaced regardless of automation mode, because the failure they
 * guard against is the same in either: a scored interview that nobody looks at.
 * Under `human_in_loop` the application rests at `interview_scored` by design;
 * under `fully_auto` it lands in `manager_review` on its own. Neither state sent
 * any signal before, so a finished interview could sit indefinitely with the
 * candidate waiting and nobody aware they were the bottleneck.
 */
const AWAITING_DECISION_STATES = ["interview_scored", "manager_review"] as const;

/**
 * Campaigns owned by `userId` with applications parked in a post-interview
 * human-decision state. Grouped one row per campaign, busiest first. SELECT-only.
 */
export async function fetchAwaitingDecisionNotifications(
  userId: string,
): Promise<AwaitingDecisionNotification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("campaign_id, campaigns!inner(title, user_id, deleted_at)")
    .in("status", [...AWAITING_DECISION_STATES])
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return [];

  const byCampaign = new Map<string, { title: string; count: number }>();
  for (const row of data as unknown as Array<{
    campaign_id: string;
    campaigns: { title: string };
  }>) {
    const existing = byCampaign.get(row.campaign_id);
    if (existing) existing.count += 1;
    else byCampaign.set(row.campaign_id, { title: row.campaigns.title, count: 1 });
  }

  return [...byCampaign.entries()]
    .map(([campaign_id, v]) => ({
      campaign_id,
      campaign_title: v.title,
      awaiting_count: v.count,
    }))
    .sort((a, b) => b.awaiting_count - a.awaiting_count);
}

const STAGE_LABEL: Record<SlaStage, string> = Object.fromEntries(
  SLA_STAGES.map((s) => [s.key, s.name]),
) as Record<SlaStage, string>;

const LEVEL_RANK: Record<SlaBreachLevel, number> = { alert: 1, escalation: 2 };

/**
 * Candidates that have sat in a pipeline stage past that stage's SLA, for the
 * recruiter's **Active** campaigns (SLA is moot on a frozen campaign). Grouped
 * to one row per campaign + stage, carrying the worst breach level present and a
 * count. Drives the SLA half of the notification bell. SELECT-only; `now` is
 * injectable for testability.
 */
export async function fetchSlaBreachNotifications(
  userId: string,
  now: Date = new Date(),
): Promise<SlaBreachNotification[]> {
  const supabase = await createClient();

  // 1. The owner's active campaigns that actually have SLA timers configured.
  const { data: timerRows, error: timerErr } = await supabase
    .from("sla_timers")
    .select(
      "campaign_id, stage, time_limit_hours, alert_threshold_hours, escalation_threshold_hours, campaigns!inner(title, user_id, status, deleted_at)",
    )
    .eq("campaigns.user_id", userId)
    .eq("campaigns.status", "active")
    .is("campaigns.deleted_at", null);

  if (timerErr || !timerRows || timerRows.length === 0) return [];

  const byCampaign = new Map<string, { title: string; timers: SlaTimer[] }>();
  for (const row of timerRows as unknown as Array<{
    campaign_id: string;
    stage: SlaStage;
    time_limit_hours: number;
    alert_threshold_hours: number;
    escalation_threshold_hours: number;
    campaigns: { title: string };
  }>) {
    const entry = byCampaign.get(row.campaign_id) ?? {
      title: row.campaigns.title,
      timers: [],
    };
    entry.timers.push({
      stage: row.stage,
      time_limit_hours: row.time_limit_hours,
      alert_threshold_hours: row.alert_threshold_hours,
      escalation_threshold_hours: row.escalation_threshold_hours,
    });
    byCampaign.set(row.campaign_id, entry);
  }

  // 2. The applications in those campaigns (status + last-activity timestamp).
  const campaignIds = [...byCampaign.keys()];
  const { data: appRows } = await supabase
    .from("applications")
    .select("status, updated_at, campaign_id")
    .in("campaign_id", campaignIds);

  if (!appRows) return [];

  // 3. Bucket each application, compare time-in-stage to the SLA, and group.
  const grouped = new Map<
    string,
    { campaign_id: string; stage: SlaStage; level: SlaBreachLevel; count: number }
  >();
  for (const app of appRows) {
    const bucket = toCandidateStage(app.status);
    const slaStage = slaStageFor(bucket); // null for terminal buckets — no SLA
    if (!slaStage) continue;

    const campaign = byCampaign.get(app.campaign_id);
    if (!campaign) continue;

    // Same predicate the candidate table's badge and Overdue filter use, so
    // the count in the bell and the rows behind it can never disagree.
    const status = applicationSlaStatus(bucket, app.updated_at, campaign.timers, now);
    if (!status) continue;

    const key = `${app.campaign_id}:${slaStage}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      if (LEVEL_RANK[status.level] > LEVEL_RANK[existing.level]) {
        existing.level = status.level;
      }
    } else {
      grouped.set(key, {
        campaign_id: app.campaign_id,
        stage: slaStage,
        level: status.level,
        count: 1,
      });
    }
  }

  return [...grouped.values()]
    .map((g) => ({
      campaign_id: g.campaign_id,
      campaign_title: byCampaign.get(g.campaign_id)?.title ?? "",
      stage: g.stage,
      stage_label: STAGE_LABEL[g.stage],
      level: g.level,
      count: g.count,
    }))
    // Escalations first, then by how many are breaching.
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.count - a.count);
}
