import Link from "next/link";
import {
  AUTOMATION_MODES,
  INTERVIEW_PERSONAS,
  SLA_STAGES,
  formatApplicationState,
  type AutomationMode,
  type InterviewPersona,
  type SlaTimer,
} from "@/lib/constants";
import type { CampaignHistoryEntry } from "@/lib/data/transitions";
import { relativeAge } from "@/lib/campaigns/detail-view";
import { ActorMark, actorFromTransition } from "@/components/ui";
import { initialsFromEmail } from "@/lib/utils";

/** Every rail panel is the same box, so it is defined once. */
const PANEL =
  "rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

const EYEBROW =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]";

/**
 * What each automation mode does to a candidate, in the terms the recruiter
 * will be held to. The constants' own descriptions say who is nominally in
 * charge; this says what happens to the person waiting.
 */
const MODE_CONSEQUENCE: Record<AutomationMode, string> = {
  human_in_loop:
    "A person approves every CV before a screening link is sent. The AI scores and waits.",
  fully_auto:
    "CVs above the threshold are sent a screening link with nobody approving it. Below it, they are rejected.",
};

/**
 * How this campaign runs — the settings that decide what happens to a candidate
 * when nobody is looking.
 *
 * The mode sits in an indigo-railed box because it is a claim about what the AI
 * is permitted to do, and the four rows under it are the facts that follow from
 * it. Recording says "Never · transcript only" because that is a property of
 * the product, not a setting: there is no switch that turns it on.
 */
export function CampaignRunCard({
  campaignId,
  automationMode,
  resumeThreshold,
  screeningThreshold,
  interviewPersona,
}: {
  campaignId: string;
  automationMode: AutomationMode;
  resumeThreshold: number;
  screeningThreshold: number;
  interviewPersona: InterviewPersona;
}) {
  const mode = AUTOMATION_MODES.find((m) => m.value === automationMode);
  const persona = INTERVIEW_PERSONAS.find((p) => p.value === interviewPersona);

  return (
    <section className={PANEL}>
      <h2 className={`${EYEBROW} mb-4`}>How this campaign runs</h2>

      <div className="mb-4 rounded-lg border border-ai-line bg-ai-wash p-3.5">
        <p className="mb-1.5 flex items-center gap-[7px] text-[13px] font-semibold text-ai-deep">
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
          {mode?.label ?? automationMode}
        </p>
        <p className="text-xs leading-[1.55] text-[#4B5563]">
          {MODE_CONSEQUENCE[automationMode]}
        </p>
      </div>

      <dl className="flex flex-col gap-3.5">
        {/* Two bars, and they are named for what they grade. One row called
            "Threshold" would recreate the single number the split removed. */}
        <RunRow term="Resume threshold">
          <span className="font-semibold tabular-nums text-ink">
            {resumeThreshold}
          </span>
        </RunRow>
        <RunRow term="Screening threshold">
          <span className="font-semibold tabular-nums text-ink">
            {screeningThreshold}
          </span>
        </RunRow>
        <RunRow term="Interview persona">
          <span className="font-semibold text-ink">
            {persona?.label ?? interviewPersona}
          </span>
        </RunRow>
        <RunRow term="Integrity monitoring">
          <span className="font-semibold text-ink">On · disclosed up front</span>
        </RunRow>
        <RunRow term="Interview recording">
          <span className="font-semibold text-ink">Never · transcript only</span>
        </RunRow>
      </dl>

      <Link
        href={`/campaigns/${campaignId}/edit`}
        className="mt-[18px] flex min-h-10 w-full items-center justify-center rounded-lg border border-[#D1D5DB] bg-white text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB]"
      >
        Change automation
      </Link>
    </section>
  );
}

function RunRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[13px] text-[#6B7280]">{term}</dt>
      <dd className="text-right text-[13px]">{children}</dd>
    </div>
  );
}

const SLA_STAGE_LABEL: Record<string, string> = {
  applied: "Review a new CV",
  screening: "Screening link validity",
  interview: "Decide after interview",
  final_interview: "Schedule the final round",
};

const SLA_STAGE_DOT: Record<string, string> = {
  applied: "bg-[#475569]",
  screening: "bg-[#2563EB]",
  interview: "bg-[#7C3AED]",
  final_interview: "bg-[#D97706]",
};

/**
 * The campaign's SLA timers, and how many candidates are currently past each.
 *
 * The disclaimer earns the panel its space: a timer that looks like automation
 * is one a recruiter assumes is handling things. It alerts a person and does
 * nothing else — it never advances anybody and never rejects anybody.
 */
export function CampaignSlaCard({
  campaignId,
  timers,
  breachesByStage,
}: {
  campaignId: string;
  timers: SlaTimer[];
  breachesByStage: Record<string, number>;
}) {
  if (timers.length === 0) return null;

  return (
    <section className={PANEL}>
      <h2 className={`${EYEBROW} mb-1.5`}>SLA timers</h2>
      <p className="mb-4 text-[13px] leading-[1.55] text-[#6B7280]">
        Timers alert a person. They never advance or reject anyone.
      </p>

      <div className="flex flex-col gap-2.5">
        {SLA_STAGES.map((stage) => {
          const timer = timers.find((t) => t.stage === stage.key);
          if (!timer) return null;
          const breached = breachesByStage[stage.key] ?? 0;
          const days = Math.round(timer.time_limit_hours / 24);
          const label = `${days} ${days === 1 ? "day" : "days"}`;

          const row = (
            <>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  breached > 0 ? "bg-[#DC2626]" : SLA_STAGE_DOT[stage.key]
                }`}
                aria-hidden="true"
              />
              <span className="flex-1 text-[13px] text-[#374151]">
                {SLA_STAGE_LABEL[stage.key] ?? stage.name}
              </span>
              <span
                className={`text-[13px] font-semibold ${
                  breached > 0 ? "text-[#B91C1C]" : "text-ink"
                }`}
              >
                {breached > 0 ? `${label} · ${breached} breached` : label}
              </span>
            </>
          );

          // A breached timer is the one row with somewhere to go.
          return breached > 0 ? (
            <Link
              key={stage.key}
              href={`/campaigns/${campaignId}/candidates?overdue=1&stage=${stage.key}`}
              className="flex items-center gap-2.5 rounded-lg border border-[#FECACA] bg-[#FFFBFB] px-3.5 py-2.5 transition-colors duration-150 hover:bg-[#FEF2F2]"
            >
              {row}
            </Link>
          ) : (
            <div
              key={stage.key}
              className="flex items-center gap-2.5 rounded-lg border border-[#E5E7EB] px-3.5 py-2.5"
            >
              {row}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Who can act on this campaign's candidates.
 *
 * The owner is always listed and always first — they are the only reviewer the
 * system can currently prove exists, and a panel that showed nothing on a
 * campaign with no invited reviewers would read as a bug.
 */
export function CampaignReviewersCard({
  ownerEmail,
  reviewers,
}: {
  ownerEmail: string;
  reviewers: { id: string; name: string; email: string; role: string }[];
}) {
  return (
    <section className={PANEL}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={EYEBROW}>Reviewers</h2>
      </div>

      <div className="flex flex-col gap-3">
        <ReviewerRow
          initials={initialsFromEmail(ownerEmail)}
          name={ownerEmail}
          detail="Owner · decides hires"
          owner
        />
        {reviewers.map((r) => (
          <ReviewerRow
            key={r.id}
            initials={initialsFromEmail(r.name || r.email || "?")}
            name={r.name || r.email || "Invited reviewer"}
            detail={`${r.role.charAt(0).toUpperCase()}${r.role.slice(1)}`}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewerRow({
  initials,
  name,
  detail,
  owner = false,
}: {
  initials: string;
  name: string;
  detail: string;
  owner?: boolean;
}) {
  return (
    <div className="flex items-center gap-[11px]">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          owner
            ? "bg-ink text-white"
            : "border border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]"
        }`}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
        <p className="text-xs text-[#6B7280]">{detail}</p>
      </div>
    </div>
  );
}

const ACTOR_LABEL: Record<string, string> = {
  system: "System",
  ai: "AI",
  recruiter: "You",
};

/**
 * Recent movement on this campaign, read off the transition log.
 *
 * `application_transitions` is the only append-only record of anything having
 * happened here, so the campaign's history is that log read across the
 * campaign — not a second, softer log written for display.
 */
export function CampaignHistoryCard({
  campaignId,
  entries,
  now,
}: {
  campaignId: string;
  entries: CampaignHistoryEntry[];
  now: Date;
}) {
  return (
    <section className={PANEL}>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 className={EYEBROW}>Campaign history</h2>
        <Link
          href={`/admin/audit?campaignId=${campaignId}`}
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          Audit log
        </Link>
      </div>

      {entries.length === 0 ? (
        <p className="text-[13px] text-[#6B7280]">
          Nothing has moved yet. Every transition lands here as it happens.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="flex gap-[11px]">
              <span className="mt-px">
                <ActorMark actor={actorFromTransition(entry.actor)} size="sm" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] text-ink">
                  <span className="font-medium">{entry.candidateName}</span> →{" "}
                  {formatApplicationState(
                    entry.toState as Parameters<typeof formatApplicationState>[0],
                  )}
                </p>
                <p className="text-xs text-[#6B7280]">
                  {ACTOR_LABEL[entry.actor] ?? entry.actor} · {relativeAge(entry.at, now)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
