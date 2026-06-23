"use server";

import { requireUserId } from "@/lib/auth/guards";
import {
  fetchPendingReviewNotifications,
  fetchSlaBreachNotifications,
  type RecruiterNotification,
} from "@/lib/data/notifications";

/**
 * Actionable items for the recruiter's notification bell, newest concern first:
 * SLA breaches (escalations before alerts) then pending human-in-the-loop
 * reviews. Both are derived live from application state — no notification table
 * to keep in sync.
 */
export async function getRecruiterNotifications(): Promise<RecruiterNotification[]> {
  const userId = await requireUserId();

  const [reviews, breaches] = await Promise.all([
    fetchPendingReviewNotifications(userId),
    fetchSlaBreachNotifications(userId),
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

  const reviewItems: RecruiterNotification[] = reviews.map((r) => ({
    id: `review:${r.campaign_id}`,
    kind: "pending_review",
    campaignId: r.campaign_id,
    campaignTitle: r.campaign_title,
    count: r.pending_review_count,
  }));

  // SLA breaches are time-sensitive — surface them above review reminders.
  return [...slaItems, ...reviewItems];
}
