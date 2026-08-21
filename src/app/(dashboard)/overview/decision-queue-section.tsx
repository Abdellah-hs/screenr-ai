import Link from "next/link";
import {
  TIER_LABELS,
  formatApplicationState,
  type ScreeningTier,
} from "@/lib/constants";
import type {
  DecisionGroup,
  DecisionItem,
  DecisionQueue,
} from "@/lib/overview/decision-queue";

// Same tones as the tier badges everywhere else — a verdict must not read one
// way on the overview and another on the record. `eligible` / `ineligible` are
// not points on the strong→no_match scale, so they borrow the pass and fail
// ends rather than being placed somewhere along it.
const TIER_TONE: Record<ScreeningTier, string> = {
  strong: "text-tier-strong bg-[#ECFDF5] border-[#A7F3D0]",
  moderate: "text-tier-potential bg-[#FEF3C7] border-[#FDE68A]",
  weak: "text-tier-weak bg-[#FEF2F2] border-[#FECACA]",
  no_match: "text-tier-no-match bg-[#FEE2E2] border-[#FCA5A5]",
  eligible: "text-tier-strong bg-[#ECFDF5] border-[#A7F3D0]",
  ineligible: "text-tier-weak bg-[#FEF2F2] border-[#FECACA]",
};

const GROUP_TONE: Record<DecisionGroup["key"], string> = {
  overdue: "border-[#FCA5A5] bg-[#FEF2F2]",
  decide: "border-[#FDE68A] bg-[#FFFBEB]",
  approve: "border-[#FDE68A] bg-[#FFFBEB]",
  lapsed: "border-[#E5E7EB] bg-[#F9FAFB]",
};

/**
 * The decision queue: every application waiting on this recruiter, grouped by
 * what happens if they do nothing, and named rather than counted.
 *
 * It sits above the KPI tiles because a number that went up is not work — the
 * only thing on this page that changes a candidate's day is somebody opening
 * one of these rows.
 */
export function DecisionQueueSection({ queue }: { queue: DecisionQueue }) {
  if (queue.groups.length === 0) {
    return (
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
          Needs you
        </h2>
        <p className="mt-3 text-sm text-[#6B7280]">
          Nothing is waiting on a decision. Approvals, scored interviews, and
          anything past its SLA land here — and nothing moves out of them on its
          own.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
            Needs you
          </h2>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Ordered by what happens if you do nothing
          </p>
        </div>
      </div>

      {queue.groups.map((group) => (
        <div
          key={group.key}
          className={`overflow-hidden rounded-xl border ${GROUP_TONE[group.key]}`}
        >
          <div className="px-5 py-3">
            <p
              className={`text-sm font-semibold ${
                group.key === "overdue" ? "text-[#991B1B]" : "text-ink"
              }`}
            >
              {group.title}
            </p>
            <p className="mt-0.5 text-xs text-[#6B7280]">{group.subtitle}</p>
          </div>

          <ul className="divide-y divide-[#F3F4F6] border-t border-[#E5E7EB] bg-white">
            {group.items.map((item) => (
              <li key={item.applicationId}>
                <QueueRow item={item} lapsed={group.key === "lapsed"} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function QueueRow({ item, lapsed }: { item: DecisionItem; lapsed: boolean }) {
  const href = `/campaigns/${item.campaignId}/candidates/${item.applicationId}`;

  return (
    <Link
      href={href}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors duration-150 hover:bg-[#F9FAFB]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {item.candidateName}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[#6B7280]">
          {item.campaignTitle} · {formatApplicationState(item.status)} ·{" "}
          {waitedFor(item.hoursInStage)}
        </span>
      </span>

      {/* Score and verdict are one object: nobody should read a 61 without
          seeing which stage produced it and that it moved nobody. */}
      {item.score !== null && (
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-ink">
            {item.score}
          </span>
          {item.tier && (
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                TIER_TONE[item.tier]
              }`}
            >
              {TIER_LABELS[item.tier]}
            </span>
          )}
        </span>
      )}

      {item.sla && (
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
            item.sla.level === "escalation"
              ? "border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]"
              : "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]"
          }`}
        >
          {item.sla.level === "escalation" ? "Overdue · escalated" : "Overdue"}
        </span>
      )}

      <span className="shrink-0 text-xs font-semibold text-primary">
        {lapsed ? "Review →" : "Open the file →"}
      </span>
    </Link>
  );
}

/** "waiting 12 days" reads better in a row than a bare "12d". */
function waitedFor(hours: number): string {
  if (hours < 1) return "waiting under an hour";
  if (hours < 24) {
    const h = Math.floor(hours);
    return `waiting ${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const d = Math.floor(hours / 24);
  return `waiting ${d} ${d === 1 ? "day" : "days"}`;
}
