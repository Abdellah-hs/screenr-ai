import Link from "next/link";
import type { ReactNode } from "react";
import { requireUserId } from "@/lib/auth/guards";
import {
  fetchActiveCampaignsLite,
  fetchPipelineStageCounts,
  fetchHiredCount,
  fetchExpiringScreeningLinks,
  fetchRecentOutcomes,
  fetchDecisionQueueRows,
  fetchCampaignSlaContext,
  type ExpiringScreeningLink,
  type RecentOutcome,
} from "@/lib/data/overview";
import {
  decisionQueueHeadline,
  groupDecisionQueue,
  toDecisionItem,
} from "@/lib/overview/decision-queue";
import { DecisionQueueSection } from "./decision-queue-section";
import { FUNNEL_STAGES } from "@/components/campaigns/pipeline-funnel";

export default async function OverviewPage() {
  const userId = await requireUserId();

  const [
    campaigns,
    pipeline,
    hired,
    expiring,
    outcomes,
    queueRows,
    slaByCampaign,
  ] = await Promise.all([
    fetchActiveCampaignsLite(userId),
    fetchPipelineStageCounts(userId),
    fetchHiredCount(userId),
    fetchExpiringScreeningLinks(userId),
    fetchRecentOutcomes(userId, 6),
    fetchDecisionQueueRows(userId),
    fetchCampaignSlaContext(userId),
  ]);

  const queue = groupDecisionQueue(
    queueRows.map((row) => toDecisionItem(row, slaByCampaign[row.campaignId] ?? [])),
  );

  const inPipeline =
    pipeline.buckets.applied +
    pipeline.buckets.screening +
    pipeline.buckets.interview +
    pipeline.buckets.final_interview;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-ink">Overview</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          {decisionQueueHeadline(queue)} Nothing below has moved on its own.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* The queue is the page. Everything in the rail is context for it. */}
        <div className="lg:col-span-2">
          <DecisionQueueSection queue={queue} />
        </div>

        <div className="space-y-6">
          {/* Counts, not work — which is why they sit beside the queue rather
              than above it. A tile that goes up is not a thing to do. */}
          <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink">
              Where things stand
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <StatTile
                label="Active campaigns"
                value={campaigns.length}
                href="/campaigns"
              />
              <StatTile label="People in pipeline" value={inPipeline} />
              <StatTile
                label="Awaiting your decision"
                value={queue.waitingCount}
                accent={queue.waitingCount > 0 ? "text-[#B45309]" : undefined}
              />
              <StatTile label="Hired" value={hired} accent="text-[#047857]" />
            </div>
          </section>

          <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
                Pipeline
              </h2>
              <Link
                href="/campaigns"
                className="text-sm font-medium text-primary hover:underline"
              >
                Campaigns
              </Link>
            </div>
            {pipeline.total === 0 ? (
              <EmptyHint>
                No candidates in your active campaigns yet. Set a campaign to{" "}
                <span className="font-medium">Active</span> and share its apply
                link to get started.
              </EmptyHint>
            ) : (
              <ul className="space-y-2">
                {FUNNEL_STAGES.map((stage) => {
                  const count =
                    pipeline.buckets[stage.key as keyof typeof pipeline.buckets] ?? 0;
                  return (
                    <li
                      key={stage.key}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${stage.iconWrap}`}
                        >
                          {stage.icon}
                        </span>
                        <span className="truncate text-sm text-[#4B5563]">
                          {stage.name}
                        </span>
                      </span>
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          count > 0 ? stage.accent : "text-[#D1D5DB]"
                        }`}
                      >
                        {count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink">
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

          <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink">
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

/**
 * A count in the rail. No icon: four coloured glyphs beside four numbers is
 * decoration competing with the queue, and none of them is a thing to do.
 */
function StatTile({
  label,
  value,
  accent = "text-ink",
  href,
}: {
  label: string;
  value: number;
  accent?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className={`text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
      <p className="mt-0.5 text-xs text-[#6B7280]">{label}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg transition-colors duration-150 hover:text-primary"
      >
        {body}
      </Link>
    );
  }
  return <div>{body}</div>;
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
