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

/** Heroicons v2 outline paths, one per kind: clock, x-circle, check-circle. */
function iconPath(kind: RecruiterNotification["kind"]): string {
  if (kind === "sla_breach") {
    return "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z";
  }
  if (kind === "interview_expired") {
    return "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
  }
  return "M9 12.75L11.25 15 15 9.75m6 2.25a9 9 0 11-18 0 9 9 0 0118 0z";
}
