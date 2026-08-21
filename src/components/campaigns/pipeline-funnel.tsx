import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One bucket of the campaign pipeline. Colours mirror the candidate-table
 * stage tokens so the funnel and the list read as the same palette. Every
 * colour class is a static string literal so Tailwind's JIT keeps them.
 */
export type FunnelStage = {
  name: string;
  key: string;
  iconWrap: string;
  accent: string;
  hover: string;
  active: string;
  ring: string;
  icon: ReactNode;
};

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/**
 * Meta-bucket for "everyone". Not a pipeline stage — it's the reset/overview
 * entry point, shown first in the interactive filter so there's always an
 * obvious way back to the full list.
 */
export const ALL_FUNNEL_STAGE: FunnelStage = {
  name: "All",
  key: "all",
  iconWrap: "bg-[#F1F5F9] text-[#334155]",
  accent: "text-[#111827]",
  hover: "border-[#E5E7EB] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]",
  active: "border-[#CBD5E1] bg-[#F1F5F9] ring-2 ring-[#94A3B8]",
  ring: "focus-visible:ring-[#94A3B8]",
  icon: (
    <svg {...iconProps}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  ),
};

/** The forward funnel, in pipeline order, ending with the Rejected bucket. */
export const FUNNEL_STAGES: FunnelStage[] = [
  {
    name: "New",
    key: "applied",
    iconWrap: "bg-[#F1F5F9] text-[#475569]",
    accent: "text-[#475569]",
    hover: "border-[#E5E7EB] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]",
    active: "border-[#CBD5E1] bg-[#F8FAFC] ring-2 ring-[#94A3B8]",
    ring: "focus-visible:ring-[#94A3B8]",
    icon: (
      <svg {...iconProps}>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    name: "Screening",
    key: "screening",
    iconWrap: "bg-[#EFF6FF] text-[#2563EB]",
    accent: "text-[#2563EB]",
    hover: "border-[#E5E7EB] hover:border-[#BFDBFE] hover:bg-[#EFF6FF]",
    active: "border-[#BFDBFE] bg-[#EFF6FF] ring-2 ring-[#60A5FA]",
    ring: "focus-visible:ring-[#60A5FA]",
    icon: (
      <svg {...iconProps}>
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
  },
  {
    name: "Interview",
    key: "interview",
    iconWrap: "bg-[#F5F3FF] text-[#7C3AED]",
    accent: "text-[#7C3AED]",
    hover: "border-[#E5E7EB] hover:border-[#DDD6FE] hover:bg-[#F5F3FF]",
    active: "border-[#DDD6FE] bg-[#F5F3FF] ring-2 ring-[#A78BFA]",
    ring: "focus-visible:ring-[#A78BFA]",
    icon: (
      <svg {...iconProps}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    ),
  },
  {
    name: "Final Interview",
    key: "final_interview",
    iconWrap: "bg-[#FEF3C7] text-[#D97706]",
    accent: "text-[#D97706]",
    hover: "border-[#E5E7EB] hover:border-[#FDE68A] hover:bg-[#FEF3C7]",
    active: "border-[#FDE68A] bg-[#FEF3C7] ring-2 ring-[#FBBF24]",
    ring: "focus-visible:ring-[#FBBF24]",
    icon: (
      <svg {...iconProps}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    name: "Hired",
    key: "hired",
    iconWrap: "bg-[#ECFDF5] text-[#059669]",
    accent: "text-[#059669]",
    hover: "border-[#E5E7EB] hover:border-[#A7F3D0] hover:bg-[#ECFDF5]",
    active: "border-[#A7F3D0] bg-[#ECFDF5] ring-2 ring-[#34D399]",
    ring: "focus-visible:ring-[#34D399]",
    icon: (
      <svg {...iconProps}>
        <path d="M11.5 15H7a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="m16 19 2 2 4-4" />
      </svg>
    ),
  },
  {
    name: "Rejected",
    key: "rejected",
    iconWrap: "bg-[#FEF2F2] text-[#DC2626]",
    accent: "text-[#DC2626]",
    hover: "border-[#E5E7EB] hover:border-[#FECACA] hover:bg-[#FEF2F2]",
    active: "border-[#FECACA] bg-[#FEF2F2] ring-2 ring-[#F87171]",
    ring: "focus-visible:ring-[#F87171]",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
    ),
  },
];

/**
 * Terminal housekeeping bucket. Not part of the forward funnel and only shown
 * where archived applications are split out of Rejected (the candidate list).
 */
export const ARCHIVED_FUNNEL_STAGE: FunnelStage = {
  name: "Archived",
  key: "archived",
  iconWrap: "bg-[#F3F4F6] text-[#6B7280]",
  accent: "text-[#6B7280]",
  hover: "border-[#E5E7EB] hover:border-[#E5E7EB] hover:bg-[#F9FAFB]",
  active: "border-[#D1D5DB] bg-[#F3F4F6] ring-2 ring-[#9CA3AF]",
  ring: "focus-visible:ring-[#9CA3AF]",
  icon: (
    <svg {...iconProps}>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  ),
};

const cardBase =
  "group flex w-full flex-col rounded-lg border bg-white p-3 text-left transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";

/**
 * One funnel card. Renders as a link (overview, `href`) or a toggle button
 * (interactive filter, `onClick` + `active`). The count greys out at zero.
 */
export function FunnelCard({
  stage,
  count,
  href,
  onClick,
  active = false,
}: {
  stage: FunnelStage;
  count: number;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = `${cardBase} ${active ? stage.active : stage.hover} ${stage.ring}`;
  const inner = (
    <>
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
      <p className="mt-1.5 truncate text-xs font-medium text-[#6B7280]" title={stage.name}>
        {stage.name}
      </p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {inner}
    </button>
  );
}

/**
 * Static campaign-pipeline overview (campaign detail page): one card per coarse
 * stage bucket, each a deep link into the candidate list filtered to that
 * stage. The summary line reconciles the buckets back to the total, since the
 * forward stages alone never sum to the candidate count once anyone is closed
 * (rejected/archived). Archived is folded into Rejected here — the fine split
 * lives on the candidate list.
 */
export function PipelineFunnel({
  campaignId,
  stageCounts,
  total,
  activeStage,
  hrefFor,
}: {
  campaignId: string;
  stageCounts: Record<string, number>;
  total: number;
  /** Highlighted card — the stage the page is currently previewing. */
  activeStage?: string;
  /** Where a card goes. Defaults to the filtered candidate list. */
  hrefFor?: (stageKey: string) => string;
}) {
  const active =
    (stageCounts.applied ?? 0) +
    (stageCounts.screening ?? 0) +
    (stageCounts.interview ?? 0) +
    (stageCounts.final_interview ?? 0);
  const hired = stageCounts.hired ?? 0;
  const closed = total - active - hired;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {FUNNEL_STAGES.map((stage) => (
          <FunnelCard
            key={stage.key}
            stage={stage}
            count={stageCounts[stage.key] ?? 0}
            active={activeStage === stage.key}
            href={
              hrefFor
                ? hrefFor(stage.key)
                : `/campaigns/${campaignId}/candidates?stage=${stage.key}`
            }
          />
        ))}
      </div>

      <div className="mt-3">
        <PipelineSummary total={total} active={active} hired={hired} closed={closed} />
      </div>
    </div>
  );
}

/** Shared reconciliation line: total split into active / hired / closed. */
export function PipelineSummary({
  total,
  active,
  hired,
  closed,
}: {
  total: number;
  active: number;
  hired: number;
  closed: number;
}) {
  return (
    <p className="text-xs text-[#6B7280]">
      <span className="font-semibold text-[#111827]">{total}</span> total
      <span className="mx-1.5 text-[#D1D5DB]">·</span>
      {active} active
      <span className="mx-1.5 text-[#D1D5DB]">·</span>
      {hired} hired
      <span className="mx-1.5 text-[#D1D5DB]">·</span>
      {closed} closed
    </p>
  );
}
