import type { RecruiterNotification } from "@/lib/data/notifications";

/**
 * Shared presentation for one recruiter notification.
 *
 * The bell (client) and the overview page's "Awaiting you" list (server) render
 * the same view-model and had drifted into two byte-identical copies of the icon
 * plus two hand-maintained ternaries of the copy. Adding a third notification
 * kind is what made that untenable — a kind added to one and missed in the other
 * silently renders as "awaiting review", which is the wrong sentence entirely.
 *
 * No hooks, so it works in either environment.
 */

/** The line the recruiter reads first — continues after the campaign title. */
export function notificationSummary(n: RecruiterNotification): string {
  const plural = n.count === 1 ? "" : "s";

  if (n.kind === "sla_breach") {
    return `: ${n.count} candidate${plural} over SLA in ${n.stageLabel}`;
  }
  if (n.kind === "interview_expired") {
    return `: ${n.count} candidate${plural} missed their interview`;
  }
  if (n.kind === "awaiting_decision") {
    return `: ${n.count} interviewed candidate${plural} waiting on a decision`;
  }
  return ` has ${n.count} candidate${plural} awaiting review`;
}

export function notificationCaption(n: RecruiterNotification): string {
  if (n.kind === "sla_breach") {
    return `${n.level === "escalation" ? "Escalation" : "Alert"} · tap to review`;
  }
  if (n.kind === "interview_expired") {
    // Says the deadline passed, not that anyone is waiting on the recruiter —
    // this one already happened and can't be actioned back into the funnel.
    return "Interview deadline passed · tap to review";
  }
  if (n.kind === "awaiting_decision") {
    // The candidate has finished everything asked of them; we are the holdup.
    return "Interview scored · tap to decide";
  }
  return "Human-in-the-loop · tap to review";
}

export function NotificationIcon({
  notification,
}: {
  notification: RecruiterNotification;
}) {
  // Red for what has already gone wrong (SLA escalation, a lapsed interview);
  // amber for what still needs attention (SLA alert, pending review).
  const isRed =
    (notification.kind === "sla_breach" && notification.level === "escalation") ||
    notification.kind === "interview_expired";
  const tone = isRed ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#FFFBEB] text-[#B45309]";

  return (
    <span
      className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={iconPath(notification.kind)} />
      </svg>
    </span>
  );
}

/**
 * Heroicons v2 outline paths, one per kind: clock, x-circle, scale (a decision
 * to weigh), check-circle.
 */
function iconPath(kind: RecruiterNotification["kind"]): string {
  if (kind === "sla_breach") {
    return "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z";
  }
  if (kind === "interview_expired") {
    return "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
  }
  if (kind === "awaiting_decision") {
    return "M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.4 48.4 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.99 5.99 0 01-2.031.352 5.99 5.99 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.99 5.99 0 01-2.031.352 5.99 5.99 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z";
  }
  return "M9 12.75L11.25 15 15 9.75m6 2.25a9 9 0 11-18 0 9 9 0 0118 0z";
}

/**
 * Where a notification lands when tapped.
 *
 * Every kind used to link at the campaign's candidate list unfiltered, which
 * meant the recruiter arrived at the whole pipeline and had to reconstruct by
 * hand which four people the bell was talking about. Deep-linking hands them
 * the same set the count was computed from.
 *
 * `interview_expired` and `awaiting_decision` stay unfiltered on purpose: the
 * table's pills are coarse pipeline buckets, and neither of those states has a
 * pill of its own — a link to `?stage=rejected` would be actively wrong for a
 * candidate awaiting a decision.
 */
export function notificationHref(n: RecruiterNotification): string {
  const base = `/campaigns/${n.campaignId}/candidates`;

  if (n.kind === "sla_breach" && n.stage) {
    return `${base}?overdue=1&stage=${n.stage}`;
  }
  if (n.kind === "pending_review") {
    return `${base}?stage=pending_review`;
  }
  return base;
}
