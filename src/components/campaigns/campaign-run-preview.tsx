"use client";

import {
  campaignRunSteps,
  runStepSummary,
  type RunActor,
  type RunConfig,
} from "@/lib/campaigns/run-preview";

const ACTOR_LABEL: Record<RunActor, string> = {
  automatic: "Automatic",
  person: "A person",
  candidate: "The candidate",
  blocked: "Will not run",
};

const ACTOR_TONE: Record<RunActor, string> = {
  automatic: "border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]",
  person: "border-[#D1D5DB] bg-white text-ink",
  candidate: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
  blocked: "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]",
};

export interface PreflightItem {
  label: string;
  done: boolean;
}

/**
 * What the settings on the left will actually do, as the sequence a candidate
 * will experience.
 *
 * A create form shows fields, not consequences: you can fill in every input on
 * this page and still not know whether anything happens when you press Create,
 * or where a person has to act. This answers both while there is still time to
 * change an answer.
 */
export function CampaignRunPreview({
  config,
  preflight,
}: {
  config: RunConfig;
  preflight: PreflightItem[];
}) {
  const steps = campaignRunSteps(config);

  return (
    <div className="space-y-4 lg:sticky lg:top-6">
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
          What this will run
        </h2>
        <p className="mt-1 text-xs text-[#6B7280]">
          Every step, in order, from the settings on the left.
        </p>

        <ol className="mt-4 space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums ${
                  ACTOR_TONE[step.actor]
                }`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6B7280]">
                  {step.detail}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {ACTOR_LABEL[step.actor]}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-4 border-t border-[#F3F4F6] pt-3 text-xs text-[#6B7280]">
          {runStepSummary(steps)} Change the automation mode to move that line.
        </p>
      </section>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
          Before you create
        </h2>
        <ul className="mt-3 space-y-2">
          {preflight.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-sm">
              <svg
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  item.done ? "text-[#059669]" : "text-[#D1D5DB]"
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={item.done ? "M5 13l4 4L19 7" : "M21 12a9 9 0 11-18 0 9 9 0 0118 0z"}
                />
              </svg>
              <span className={item.done ? "text-[#4B5563]" : "text-[#9CA3AF]"}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-[#F3F4F6] pt-3 text-xs text-[#6B7280]">
          Screening questions come after you create — a candidate cannot be approved
          into screening until they exist.
        </p>
      </section>
    </div>
  );
}
