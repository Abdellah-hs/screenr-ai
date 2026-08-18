"use server";

import { requireUserId } from "@/lib/auth/guards";
import {
  fetchAwaitingDecisionNotifications,
  fetchExpiredInterviewNotifications,
  fetchPendingReviewNotifications,
  fetchSlaBreachNotifications,
  type RecruiterNotification,
} from "@/lib/data/notifications";

/**
 * Actionable items for the recruiter's notification bell, newest concern first:
 * SLA breaches (escalations before alerts), then expired AI interviews, then
 * pending human-in-the-loop reviews. All derived live from application state —
 * no notification table to keep in sync.
 */
export async function getRecruiterNotifications(): Promise<RecruiterNotification[]> {
  const userId = await requireUserId();

  const [reviews, breaches, expiredInterviews, awaitingDecision] = await Promise.all([
    fetchPendingReviewNotifications(userId),
    fetchSlaBreachNotifications(userId),
    fetchExpiredInterviewNotifications(userId),
    fetchAwaitingDecisionNotifications(userId),
  ]);

  const slaItems: RecruiterNotification[] = breaches.map((b) => ({
    id: `sla:${b.campaign_id}:${b.stage}`,
    kind: "sla_breach",
    campaignId: b.campaign_id,
    campaignTitle: b.campaign_title,
    count: b.count,
    stageLabel: b.stage_label,
    level: b.level,
  }));

  const expiredItems: RecruiterNotification[] = expiredInterviews.map((e) => ({
    id: `interview-expired:${e.campaign_id}`,
    kind: "interview_expired",
    campaignId: e.campaign_id,
    campaignTitle: e.campaign_title,
    count: e.expired_count,
  }));

  const reviewItems: RecruiterNotification[] = reviews.map((r) => ({
    id: `review:${r.campaign_id}`,
    kind: "pending_review",
    campaignId: r.campaign_id,
    campaignTitle: r.campaign_title,
    count: r.pending_review_count,
  }));

  const awaitingItems: RecruiterNotification[] = awaitingDecision.map((a) => ({
    id: `awaiting-decision:${a.campaign_id}`,
    kind: "awaiting_decision",
    campaignId: a.campaign_id,
    campaignTitle: a.campaign_title,
    count: a.awaiting_count,
  }));

  // SLA breaches are time-sensitive — surface them above the rest. Expired
  // interviews sit above review reminders: a review is waiting for the
  // recruiter, an expiry already happened without them. Post-interview
  // decisions come last of the actionable items: the candidate has done
  // everything asked of them and is waiting on us, but nothing is decaying.
  return [...slaItems, ...expiredItems, ...reviewItems, ...awaitingItems];
}
