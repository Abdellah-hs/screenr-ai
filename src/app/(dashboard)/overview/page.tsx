import Link from "next/link";
import type { ReactNode } from "react";
import { requireUserId } from "@/lib/auth/guards";
import {
  fetchActiveCampaignsLite,
  fetchPipelineStageCounts,
  fetchExpiringScreeningLinks,
  fetchRecentOutcomes,
  fetchDecisionQueueRows,
  fetchCampaignSlaContext,
  type ExpiringScreeningLink,
  type RecentOutcome,
} from "@/lib/data/overview";
import { groupDecisionQueue, toDecisionItem } from "@/lib/overview/decision-queue";
import { DecisionQueueSection } from "./decision-queue-section";
import {
  ARCHIVED_FUNNEL_STAGE,
  FUNNEL_STAGES,
  FUNNEL_STAGE_BY_KEY,
  type FunnelStage,
} from "@/components/campaigns/pipeline-funnel";
import { TERMINAL_CANDIDATE_STAGES, inPlayCandidateCount } from "@/lib/constants";

// Which stages are an outcome and which are still in play is a fact about the
// PIPELINE, not about this page — see `constants.ts`. Read from there so adding
// a stage cannot leave the rail and the "in play" figure describing different
// pipelines.
const IN_PLAY_STAGES = FUNNEL_STAGES.filter(
  (s) => !TERMINAL_CANDIDATE_STAGES.some((terminal) => terminal === s.key),
);

const HIRED_STAGE = FUNNEL_STAGE_BY_KEY.hired;
const REJECTED_STAGE = FUNNEL_STAGE_BY_KEY.rejected;

/**
 * Everything that ended without anybody turning the candidate down — a link
 * that ran out, a no-show, a CV that could not be read, an archive sweep.
 *
 * It borrows the archived row's grey because the point of the row is that it is
 * *not* a verdict: `toCandidateStage` folds these into the `rejected` bucket,
 * so the rail was reporting them as rejections directly beside a queue group
 * headed "nobody was rejected".
 */
const CLOSED_OUT_STAGE: FunnelStage = { ...ARCHIVED_FUNNEL_STAGE, name: "Closed, no decision" };

export default async function OverviewPage() {
  const userId = await requireUserId();

  const [campaigns, pipeline, expiring, outcomes, queueRows, slaByCampaign] =
    await Promise.all([
      fetchActiveCampaignsLite(userId),
      fetchPipelineStageCounts(userId),
      fetchExpiringScreeningLinks(userId),
      fetchRecentOutcomes(userId, 6),
      fetchDecisionQueueRows(userId),
      fetchCampaignSlaContext(userId),
    ]);

  // One clock for the whole page. Left to its default, `toDecisionItem` reads
  // `new Date()` once per row, so a long list ages its rows against slightly
  // different nows and the sort key drifts from the age printed beside it.
  const now = new Date();
  const queue = groupDecisionQueue(
    queueRows.map((row) =>
      toDecisionItem(row, slaByCampaign[row.campaignId] ?? [], now),
    ),
  );

  const inPipeline = inPlayCandidateCount(pipeline.buckets);

  return (
    <div className="mx-auto max-w-7xl">
      {/* No standfirst. A count of the queue directly above the queue restated
          what the group headings already say, and the sentence beside it was a
          rule about the product rather than anything on this screen. */}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-ink">Overview</h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* The queue is the page. Everything in the rail is context for it —
            counts, not work. A tile that goes up is not a thing to do, which is
            why no count sits above the queue or repeats what it already says. */}
        <div className="lg:col-span-2">
          <DecisionQueueSection queue={queue} />
        </div>

        <div className="space-y-5">
          <RailCard
            title="Pipeline"
            action={
              <Link
                href="/campaigns"
                className="text-xs font-semibold text-primary hover:underline"
              >
                Campaigns
              </Link>
            }
          >
            {pipeline.total === 0 ? (
              <EmptyHint>
                No candidates in your active campaigns yet. Set a campaign to{" "}
                <span className="font-medium">Active</span> and share its apply
                link to get started.
              </EmptyHint>
            ) : (
              <>
                <p className="mb-4 text-xs text-[#6B7280]">
                  {inPipeline} in play across {campaigns.length}{" "}
                  {campaigns.length === 1 ? "active campaign" : "active campaigns"}
                </p>
                <ul className="space-y-1">
                  {IN_PLAY_STAGES.map((stage) => (
                    <StageRow
                      key={stage.key}
                      stage={stage}
                      count={
                        pipeline.buckets[stage.key as keyof typeof pipeline.buckets] ?? 0
                      }
                    />
                  ))}

                  {/* Outcomes, under a rule so "in play" above it adds up. The
                      rejected bucket is split here rather than shown whole:
                      only the first of these three is somebody's decision. */}
                  <StageRow
                    stage={HIRED_STAGE}
                    count={pipeline.buckets.hired}
                    startsOutcomes
                  />
                  <StageRow stage={REJECTED_STAGE} count={pipeline.rejectedOutright} />
                  <StageRow stage={CLOSED_OUT_STAGE} count={pipeline.closedOut} />
                </ul>
              </>
            )}
          </RailCard>

          {/* Rendered only when something is actually expiring: an empty
              warning panel is a warning that cries wolf every day. */}
          {expiring.length > 0 && (
            <RailCard title="Expiring soon">
              <ul className="space-y-1">
                {expiring.map((item) => (
                  <ExpiringRow key={item.campaignId} item={item} />
                ))}
              </ul>
            </RailCard>
          )}

          {/* No all-time hire counter in the header. It counted every campaign
              the recruiter has ever owned while the Pipeline card above counts
              only the Active ones, so the same page showed two numbers labelled
              "hired" that disagreed — and the one a work queue can act on is
              already in the funnel. */}
          <RailCard title="Recent decisions">
            {outcomes.length === 0 ? (
              <EmptyHint>No hires or rejections yet.</EmptyHint>
            ) : (
              <ul className="space-y-3">
                {outcomes.map((o, i) => (
                  <OutcomeRow key={`${o.campaignId}-${i}`} outcome={o} />
                ))}
              </ul>
            )}
          </RailCard>
        </div>
      </div>
    </div>
  );
}

// ─── Local presentational pieces ─────────────────────────────────────────────

/**
 * One panel in the right rail. The same shell everywhere, so the column reads
 * as one object rather than three cards that each invented their own header.
 */
function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-[#9CA3AF]">{children}</p>;
}

/** One stage of the pipeline rail: icon, name, count. */
function StageRow({
  stage,
  count,
  startsOutcomes = false,
}: {
  stage: FunnelStage;
  count: number;
  /** Draws the rule that separates who is still moving from who has stopped. */
  startsOutcomes?: boolean;
}) {
  return (
    <li className={startsOutcomes ? "mt-3 border-t border-[#F3F4F6] pt-3" : undefined}>
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${stage.iconWrap}`}
          >
            {stage.icon}
          </span>
          <span className="truncate text-sm text-[#4B5563]">{stage.name}</span>
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            count > 0 ? stage.accent : "text-[#D1D5DB]"
          }`}
        >
          {count}
        </span>
      </span>
    </li>
  );
}

function ExpiringRow({ item }: { item: ExpiringScreeningLink }) {
  return (
    <li>
      {/* Straight to the screening bucket. The unfiltered list left the reader
          to find the handful of people the warning was about among everyone who
          ever applied to that campaign. */}
      <Link
        href={`/campaigns/${item.campaignId}/candidates?stage=screening`}
        className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-[#F9FAFB]"
      >
        <span className="min-w-0 truncate text-sm text-[#111827]">
          {item.campaignTitle}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FFFBEB] px-2 py-0.5 text-xs font-medium text-[#B45309]">
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
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          {hired ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          )}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[#111827]">
          <span className="font-medium">{outcome.candidateName}</span>{" "}
          {hired ? "hired" : "rejected"}
        </span>
        <span className="block truncate text-xs text-[#6B7280]">
          {outcome.campaignTitle} · {relativeTime(outcome.at)}
        </span>
      </span>
    </li>
  );
}

/**
 * "2h ago" / "3d ago" / "4mo ago". Always relative: a list that mixes "18d ago"
 * with a raw date makes two rows of the same kind look like two kinds of fact.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
