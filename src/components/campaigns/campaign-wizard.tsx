"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createCampaign } from "@/lib/actions/campaigns";
import {
  WIZARD_STEPS,
  canLeaveStep,
  draftToFormData,
  emptyDraft,
  furthestReachable,
  progressLabel,
  stepBlockers,
  stepIndex,
  stepPosition,
  type CampaignDraft,
  type WizardStepKey,
} from "@/lib/campaigns/wizard";
import {
  StepRole,
  StepRules,
  StepRubric,
  StepTeam,
  StepReview,
  type Patch,
} from "./campaign-wizard-steps";

const LAST = WIZARD_STEPS.length - 1;

/**
 * Creating a campaign, five questions at a time.
 *
 * Two structural decisions, both load-bearing:
 *
 * 1. **Every answer lives in `draft`, here.** A step unmounts the moment you
 *    leave it, so an uncontrolled input's value would be destroyed by pressing
 *    Next and the final submit would post an empty campaign. Nothing is ever
 *    read back off the DOM — `draftToFormData` builds the payload.
 * 2. **The whole page is the `<form>`.** A submit button outside its form has
 *    no form owner, and the footer is the one place Create can live. Enter in a
 *    field therefore lands here too, which is why a submit before the last step
 *    advances rather than creating a half-answered campaign.
 */
export default function CampaignWizard() {
  const [draft, setDraft] = useState<CampaignDraft>(emptyDraft);
  const [current, setCurrent] = useState(0);
  // Blockers stay hidden until Next is actually pressed: listing what is
  // missing from a form nobody has filled in yet is nagging, not help.
  const [showBlockers, setShowBlockers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "draft" | null>(null);

  const mainRef = useRef<HTMLElement>(null);

  const step = WIZARD_STEPS[current];
  const blockers = stepBlockers(draft, step.key);
  const reachable = furthestReachable(draft, current);

  const patch: Patch = (changes) => {
    setDraft((d) => ({ ...d, ...changes }));
    setShowBlockers(false);
  };

  function goTo(index: number) {
    if (index < 0 || index > LAST || index > reachable) return;
    setCurrent(index);
    setShowBlockers(false);
    mainRef.current?.scrollTo({ top: 0 });
  }

  function goNext() {
    if (blockers.length > 0) {
      setShowBlockers(true);
      return;
    }
    goTo(current + 1);
  }

  async function create(status: CampaignDraft["status"], which: "create" | "draft") {
    setError(null);
    setBusy(which);
    try {
      await createCampaign(draftToFormData({ ...draft, status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Enter in a text field submits the form. Before the last step that means
    // "next", not "create a campaign I haven't finished describing".
    if (current < LAST) {
      goNext();
      return;
    }
    void create(draft.status, "create");
  }

  /** Anything typed is worth a confirmation before the X throws it away. */
  function confirmDiscard(e: React.MouseEvent) {
    const touched =
      draft.title.trim().length > 0 ||
      draft.description.trim().length > 0 ||
      draft.rubrics.some((r) => r.dimensions.length > 0);
    if (touched && !window.confirm("Leave without creating the campaign?")) {
      e.preventDefault();
    }
  }

  const roleComplete = canLeaveStep(draft, "role");

  return (
    <form
      id="wizard"
      onSubmit={handleSubmit}
      className="flex h-screen flex-col overflow-hidden bg-[#FAFAFA] text-ink"
    >
      <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-[#E5E7EB] bg-white px-8">
        <div className="flex items-center gap-[11px]">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary font-heading text-[17px] font-bold text-white">
            S
          </span>
          <span className="font-heading text-[17px] font-semibold tracking-[-0.01em]">
            New campaign
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* The only truthful "save draft" this product has: create the
              campaign now with status Draft. Nothing is public, scored or sent
              until it is set Active, and the wizard's remaining steps are all
              editable afterwards. */}
          <button
            type="button"
            onClick={() => void create("draft", "draft")}
            disabled={!roleComplete || busy !== null}
            title={
              roleComplete
                ? "Create it now as a Draft — nothing goes public, and you can finish the rest on the campaign page"
                : "A title and description first — a campaign cannot be saved without them"
            }
            className="min-h-10 cursor-pointer rounded-lg px-[13px] text-[13px] font-semibold text-[#6B7280] transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-[#D1D5DB]"
          >
            {busy === "draft" ? "Saving…" : "Save draft"}
          </button>

          <span className="hidden pr-1 text-xs text-[#9CA3AF] lg:inline">
            Focus mode · the sidebar returns when you finish
          </span>

          <Link
            href="/campaigns"
            onClick={confirmDiscard}
            aria-label="Close and return to campaigns"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#6B7280] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
          >
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </Link>
        </div>
      </header>

      <nav
        aria-label="Wizard steps"
        className="shrink-0 overflow-x-auto border-b border-[#E5E7EB] bg-white px-8"
      >
        <ol className="mx-auto flex min-w-[760px] max-w-[900px] items-center gap-2 py-3.5">
          {WIZARD_STEPS.map((s, i) => {
            const position = stepPosition(i, current);
            const enabled = i <= reachable;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  disabled={!enabled}
                  aria-current={position === "current" ? "step" : undefined}
                  className={`flex min-h-11 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                    enabled ? "cursor-pointer hover:bg-[#F9FAFB]" : "cursor-not-allowed"
                  }`}
                >
                  <StepMark index={i} position={position} />
                  <span
                    className={`text-[13px] ${
                      position === "current"
                        ? "font-semibold text-ink"
                        : "font-medium text-[#6B7280]"
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
                {i < LAST && (
                  <span className="h-px w-4 flex-none bg-[#E5E7EB]" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main ref={mainRef} className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-[760px]">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B7280]">
            {progressLabel(current)}
          </p>
          <h1 className="mb-2 font-heading text-[30px] font-semibold tracking-[-0.02em]">
            {step.title}
          </h1>
          <p className="mb-6 max-w-[60ch] text-[15px] leading-[1.6] text-[#4B5563]">
            {step.blurb}
          </p>

          {step.key === "role" && <StepRole draft={draft} patch={patch} />}
          {step.key === "rules" && <StepRules draft={draft} patch={patch} />}
          {step.key === "rubric" && <StepRubric draft={draft} patch={patch} />}
          {step.key === "team" && <StepTeam draft={draft} patch={patch} />}
          {step.key === "review" && (
            <StepReview
              draft={draft}
              onGoToStep={(key: WizardStepKey) => goTo(stepIndex(key))}
            />
          )}

          {showBlockers && blockers.length > 0 && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[22px] py-4"
            >
              <p className="mb-2 text-[13px] font-semibold text-[#92400E]">
                {blockers.length === 1
                  ? "One thing before you go on"
                  : `${blockers.length} things before you go on`}
              </p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                {blockers.map((blocker) => (
                  <li key={blocker} className="text-[13px] leading-[1.55] text-[#92400E]">
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-[22px] py-4 text-[13px] text-[#B91C1C]"
            >
              {error}
            </p>
          )}
        </div>
      </main>

      <div className="shrink-0 border-t border-[#E5E7EB] bg-white px-8 py-3.5">
        <div className="mx-auto flex max-w-[760px] items-center gap-3">
          {current > 0 && (
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </button>
          )}

          <span className="ml-auto flex items-center gap-3">
            <span className="text-[13px] text-[#6B7280]">{progressLabel(current)}</span>

            {current < LAST ? (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex min-h-[46px] cursor-pointer items-center gap-[9px] rounded-lg border border-ink bg-ink px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
              >
                Next
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy !== null}
                className="min-h-[46px] cursor-pointer rounded-lg border border-ink bg-ink px-[22px] text-sm font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "create" ? "Creating…" : "Create campaign"}
              </button>
            )}
          </span>
        </div>
      </div>
    </form>
  );
}

/** The numbered disc on the step rail. A finished step is an emerald check —
 *  the one place emerald belongs here, because "done" is a terminal outcome. */
function StepMark({
  index,
  position,
}: {
  index: number;
  position: "current" | "past" | "ahead";
}) {
  const base =
    "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-xs font-bold";

  if (position === "current") {
    return <span className={`${base} bg-ink text-white`}>{index + 1}</span>;
  }

  if (position === "past") {
    return (
      <span className={`${base} border border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]`}>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        <span className="sr-only">Done</span>
      </span>
    );
  }

  return (
    <span className={`${base} border border-[#E5E7EB] bg-[#F3F4F6] text-[#9CA3AF]`}>
      {index + 1}
    </span>
  );
}
