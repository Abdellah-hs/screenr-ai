import Link from "next/link";
import {
  AUTOMATION_MODES,
  INTERVIEW_PERSONAS,
  SLA_STAGES,
  type AutomationMode,
  type InterviewPersona,
  type SlaTimer,
} from "@/lib/constants";

/**
 * What each automation mode actually does to a candidate, in the terms the
 * recruiter will be held to. The constants' own descriptions say who is in
 * charge; this says what happens to the person waiting.
 */
const MODE_CONSEQUENCE: Record<AutomationMode, string> = {
  human_in_loop:
    "A person approves every CV before a screening link is sent. The AI scores and waits.",
  fully_auto:
    "CVs above the threshold are sent a screening link without anyone approving it. Below it, they are rejected.",
};

/**
 * How this campaign runs — the settings that decide what happens to a candidate
 * without anybody touching them.
 *
 * The threshold is called out as the one auto-reject in the product: everything
 * else here only changes tone or evidence. A recruiter who does not know which
 * number rejects people cannot set it responsibly.
 */
export function CampaignRunCard({
  campaignId,
  automationMode,
  screeningThreshold,
  interviewPersona,
}: {
  campaignId: string;
  automationMode: AutomationMode;
  screeningThreshold: number;
  interviewPersona: InterviewPersona;
}) {
  const mode = AUTOMATION_MODES.find((m) => m.value === automationMode);
  const persona = INTERVIEW_PERSONAS.find((p) => p.value === interviewPersona);
  const autoRejects = automationMode === "fully_auto";

  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
        How this campaign runs
      </h2>

      <p className="mt-3 text-sm font-semibold text-ink">
        {mode?.label ?? automationMode}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[#6B7280]">
        {MODE_CONSEQUENCE[automationMode]}
      </p>

      <dl className="mt-4 space-y-2.5 border-t border-[#F3F4F6] pt-4 text-sm">
        <Row
          term="Screening threshold"
          detail={
            autoRejects
              ? "The only number in the product that rejects somebody"
              : "Sorts the review queue; rejects nobody in this mode"
          }
        >
          <span className="font-semibold tabular-nums text-ink">
            {screeningThreshold}
          </span>
        </Row>
        <Row term="Interview persona">
          <span className="font-medium text-ink">
            {persona?.label ?? interviewPersona}
          </span>
        </Row>
        <Row term="Integrity monitoring" detail="Disclosed to the candidate up front">
          <span className="font-medium text-ink">On</span>
        </Row>
        <Row term="Interview recording" detail="The transcript is the record">
          <span className="font-medium text-ink">Never</span>
        </Row>
      </dl>

      <Link
        href={`/campaigns/${campaignId}/edit`}
        className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
      >
        Change how it runs
      </Link>
    </section>
  );
}

function Row({
  term,
  detail,
  children,
}: {
  term: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-[#4B5563]">{term}</dt>
        {detail && <p className="mt-0.5 text-xs text-[#9CA3AF]">{detail}</p>}
      </div>
      <dd className="shrink-0 text-right">{children}</dd>
    </div>
  );
}

const SLA_STAGE_LABEL: Record<string, string> = {
  applied: "Review a new CV",
  screening: "Complete screening",
  interview: "Decide after the interview",
  final_interview: "Schedule the final round",
};

/**
 * The campaign's SLA timers, with the count of who is currently past each one.
 *
 * The disclaimer is the whole reason this card is worth its space: a timer that
 * looks like automation is one a recruiter will assume is handling things. It
 * alerts a person and does nothing else — it never advances anybody and never
 * rejects anybody.
 */
export function CampaignSlaCard({
  campaignId,
  timers,
  breachesByStage,
}: {
  campaignId: string;
  timers: SlaTimer[];
  /** How many candidates are currently past each stage's timer. */
  breachesByStage: Record<string, number>;
}) {
  if (timers.length === 0) return null;

  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
        SLA timers
      </h2>
      <p className="mt-1 text-xs text-[#6B7280]">
        Timers alert a person. They never advance or reject anyone.
      </p>

      <dl className="mt-4 space-y-2.5 text-sm">
        {SLA_STAGES.map((stage) => {
          const timer = timers.find((t) => t.stage === stage.key);
          if (!timer) return null;
          const breached = breachesByStage[stage.key] ?? 0;
          const days = Math.round(timer.time_limit_hours / 24);

          return (
            <div key={stage.key} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate text-[#4B5563]">
                {SLA_STAGE_LABEL[stage.key] ?? stage.name}
              </dt>
              <dd className="shrink-0 text-right">
                <span className="font-medium tabular-nums text-ink">
                  {days} {days === 1 ? "day" : "days"}
                </span>
                {breached > 0 && (
                  <Link
                    href={`/campaigns/${campaignId}/candidates?overdue=1&stage=${stage.key}`}
                    className="ml-2 text-xs font-semibold text-[#B91C1C] hover:underline"
                  >
                    {breached} breached
                  </Link>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
