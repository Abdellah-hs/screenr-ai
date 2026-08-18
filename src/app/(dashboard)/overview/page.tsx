import Link from "next/link";
import type { ReactNode } from "react";
import { requireUserId } from "@/lib/auth/guards";
import { getRecruiterNotifications } from "@/lib/actions/notifications";
import {
  fetchActiveCampaignsLite,
  fetchPipelineStageCounts,
  fetchHiredCount,
  fetchExpiringScreeningLinks,
  fetchRecentOutcomes,
  type ExpiringScreeningLink,
  type RecentOutcome,
} from "@/lib/data/overview";
import { FUNNEL_STAGES } from "@/components/campaigns/pipeline-funnel";
import {
  NotificationIcon,
  notificationCaption,
  notificationSummary,
} from "@/components/notification-item";

export default async function OverviewPage() {
  const userId = await requireUserId();

  const [campaigns, pipeline, hired, expiring, outcomes, notifications] = await Promise.all([
    fetchActiveCampaignsLite(userId),
    fetchPipelineStageCounts(userId),
    fetchHiredCount(userId),
    fetchExpiringScreeningLinks(userId),
    fetchRecentOutcomes(userId, 6),
    getRecruiterNotifications(),
  ]);

  const inPipeline =
    pipeline.buckets.applied +
    pipeline.buckets.screening +
    pipeline.buckets.interview +
    pipeline.buckets.final_interview;
  const awaitingReview = notifications
    .filter((n) => n.kind === "pending_review")
    .reduce((sum, n) => sum + n.count, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#111827]">Overview</h1>
        <p className="text-sm text-[#6B7280] mt-1">Your hiring pipeline at a glance.</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active campaigns"
          value={campaigns.length}
          href="/campaigns"
          accent="text-[#2563EB]"
          iconWrap="bg-[#EFF6FF]"
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7h-3V5a2 2 0 00-2-2H9a2 2 0 00-2 2v2H4a1 1 0 00-1 1v11a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM9 5h6v2H9V5z" />
          }
        />
        <StatCard
          label="In pipeline"
          value={inPipeline}
          accent="text-[#7C3AED]"
          iconWrap="bg-[#F5F3FF]"
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.6-4.5" />
          }
        />
        <StatCard
          label="Awaiting your review"
          value={awaitingReview}
          accent={awaitingReview > 0 ? "text-[#B45309]" : "text-[#111827]"}
          iconWrap={awaitingReview > 0 ? "bg-[#FFFBEB]" : "bg-[#F3F4F6]"}
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l2 2 4-4" />
          }
        />
        <StatCard
          label="Hired"
          value={hired}
          accent="text-[#059669]"
          iconWrap="bg-[#ECFDF5]"
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          }
        />
      </div>

      {/* Pipeline funnel across active campaigns */}
      <section className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
            Pipeline · Active campaigns
          </h2>
          <Link href="/campaigns" className="text-sm font-medium text-[#2563EB] hover:underline">
            View campaigns
          </Link>
        </div>
        {pipeline.total === 0 ? (
          <EmptyHint>
            No candidates in your active campaigns yet. Set a campaign to{" "}
            <span className="font-medium">Active</span> and sync resumes to get started.
          </EmptyHint>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {FUNNEL_STAGES.map((stage) => {
              const count = pipeline.buckets[stage.key as keyof typeof pipeline.buckets] ?? 0;
              return (
                <div
                  key={stage.key}
                  className="flex flex-col rounded-lg border border-[#E5E7EB] bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md ${stage.iconWrap}`}>
                      {stage.icon}
                    </span>
                    <span
                      className={`text-xl font-semibold tabular-nums ${
                        count > 0 ? stage.accent : "text-[#D1D5DB]"
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-xs font-medium text-[#6B7280]">{stage.name}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Awaiting you — reuses the notification bell view-model */}
        <section className="lg:col-span-2 bg-white rounded-xl border border-[#E5E7EB] p-6">
          <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
            Awaiting you
          </h2>
          {notifications.length === 0 ? (
            <EmptyHint>
              You&apos;re all caught up. Reviews, SLA alerts, and expired interviews will appear
              here.
            </EmptyHint>
          ) : (
            <ul className="divide-y divide-[#F3F4F6]">
              {notifications.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/campaigns/${n.campaignId}/candidates`}
                    className="flex items-start gap-3 py-3 -mx-2 px-2 rounded-lg transition-colors hover:bg-[#F9FAFB]"
                  >
                    <NotificationIcon notification={n} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-[#111827]">
                        <span className="font-medium">{n.campaignTitle}</span>
                        {notificationSummary(n)}
                      </span>
                      <span className="block text-xs text-[#6B7280] mt-0.5">
                        {notificationCaption(n)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Side column: expiring links + recent outcomes */}
        <div className="space-y-6">
          <section className="bg-white rounded-xl border border-[#E5E7EB] p-6">
            <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
              Expiring soon
            </h2>
            {expiring.length === 0 ? (
              <EmptyHint>No screening links are about to expire.</EmptyHint>
            ) : (
              <ul className="space-y-2">
                {expiring.map((item) => (
                  <ExpiringRow key={item.campaignId} item={item} />
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-xl border border-[#E5E7EB] p-6">
            <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
              Recent outcomes
            </h2>
            {outcomes.length === 0 ? (
              <EmptyHint>No hires or rejections yet.</EmptyHint>
            ) : (
              <ul className="space-y-3">
                {outcomes.map((o, i) => (
                  <OutcomeRow key={`${o.campaignId}-${i}`} outcome={o} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Local presentational pieces ─────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  iconWrap,
  accent,
  href,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  iconWrap: string;
  accent: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconWrap}`}>
          <svg className={`h-5 w-5 ${accent}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            {icon}
          </svg>
        </span>
      </div>
      <p className={`mt-3 text-3xl font-semibold tabular-nums ${accent}`}>{value}</p>
      <p className="text-sm text-[#6B7280] mt-0.5">{label}</p>
    </>
  );

  const className =
    "block bg-white rounded-xl border border-[#E5E7EB] p-5 transition-colors";
  if (href) {
    return (
      <Link href={href} className={`${className} hover:border-[#CBD5E1] hover:bg-[#F8FAFC] cursor-pointer`}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#9CA3AF] py-4">{children}</p>;
}

function ExpiringRow({ item }: { item: ExpiringScreeningLink }) {
  return (
    <li>
      <Link
        href={`/campaigns/${item.campaignId}/candidates`}
        className="flex items-center justify-between gap-3 -mx-2 px-2 py-2 rounded-lg transition-colors hover:bg-[#F9FAFB]"
      >
        <span className="min-w-0 truncate text-sm text-[#111827]">{item.campaignTitle}</span>
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#FFFBEB] px-2 py-0.5 text-xs font-medium text-[#B45309]">
          {item.count} expiring
        </span>
      </Link>
    </li>
  );
}

function OutcomeRow({ outcome }: { outcome: RecentOutcome }) {
  const hired = outcome.outcome === "hired";
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          hired ? "bg-[#ECFDF5] text-[#059669]" : "bg-[#FEF2F2] text-[#DC2626]"
        }`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          {hired ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          )}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[#111827] truncate">
          <span className="font-medium">{outcome.candidateName}</span>{" "}
          {hired ? "hired" : "rejected"}
        </span>
        <span className="block text-xs text-[#6B7280] truncate">
          {outcome.campaignTitle} · {relativeTime(outcome.at)}
        </span>
      </span>
    </li>
  );
}

/** Compact "2h ago" / "3d ago" relative label from an ISO timestamp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
