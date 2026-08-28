"use client";

import { useRef, useState, type FormEvent } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Button, Modal, ModalFooter, ModalHeader } from "@/components/ui";
import {
  createCampaign,
  updateCampaign,
  type CreateCampaignFinish,
} from "@/lib/actions/campaigns";
import { checkScreeningCoverage } from "@/lib/actions/screening-coverage";
import type { Campaign } from "@/lib/constants";
import {
  coverageBlockers,
  coverageSignature,
  type ScreeningCoverageResult,
} from "@/lib/screening/coverage";
import {
  WIZARD_STEPS,
  canLeaveStep,
  dimensionsFor,
  draftFromCampaign,
  draftToFormData,
  emptyDraft,
  furthestReachable,
  discardSummary,
  progressLabel,
  stepBlockers,
  stepPosition,
  wizardRail,
  type CampaignDraft,
} from "@/lib/campaigns/wizard";
import {
  StepRole,
  StepRules,
  StepRubric,
  StepTeam,
  StepReview,
  type Patch,
} from "./campaign-wizard-steps";
import {
  StepMark,
  WizardBrandHeader,
  WizardCloseLink,
  WizardRail,
} from "./wizard-chrome";

const LAST = WIZARD_STEPS.length - 1;

/**
 * A campaign, five questions at a time — for creating one and for editing one.
 *
 * **One component, both jobs, on purpose.** The edit page used to be a separate
 * single-page form with its own layout, its own field markup and its own idea
 * of what a campaign has. That is how it drifted: it grew a paragraph pointing
 * at another page instead of a screening-questions section, and every field
 * added to the wizard had to be remembered here too or it silently became
 * uneditable. Editing now walks the same five steps, seeded from the row
 * (`draftFromCampaign`) and posted through the same serialiser
 * (`draftToFormData`), so a field cannot exist on one side and not the other.
 *
 * Three structural decisions, all load-bearing:
 *
 * 1. **Every answer lives in `draft`, here.** A step unmounts the moment you
 *    leave it, so an uncontrolled input's value would be destroyed by pressing
 *    Next and the final submit would post an empty campaign. Nothing is ever
 *    read back off the DOM — `draftToFormData` builds the payload.
 * 2. **The whole page is the `<form>`.** A submit button outside its form has
 *    no form owner, and the footer is the one place Create can live. Enter in a
 *    field therefore lands here too, which is why a submit before the last step
 *    advances rather than creating a half-answered campaign.
 * 3. **One page, one scroll.** The brand row, the step rail and the action row
 *    sit inside the same centred column as the fields. They were edge-to-edge
 *    bars pinned to a viewport-height shell whose middle scrolled on its own,
 *    which framed a narrow column between two rules and read as a dialog stuck
 *    to the window rather than as this page. Nothing here is sticky.
 */
export default function CampaignWizard({
  campaign,
  initialQuestions = [],
}: {
  /**
   * Present when editing. Its absence is what makes this the create wizard —
   * there is no `mode` prop to get out of step with the data.
   */
  campaign?: Campaign;
  /** The campaign's saved screening questions. Create starts with none. */
  initialQuestions?: { id?: string; prompt: string }[];
}) {
  const editing = campaign !== undefined;
  // Kept so the close button can tell "changed nothing" from "changed
  // something". On an edit every field starts filled in, so the create form's
  // "is there a title yet" heuristic would confirm every single exit.
  const [initialDraft] = useState<CampaignDraft>(() =>
    campaign ? draftFromCampaign(campaign, initialQuestions) : emptyDraft(),
  );
  const [draft, setDraft] = useState<CampaignDraft>(initialDraft);
  const [current, setCurrent] = useState(0);
  // Blockers stay hidden until Next is actually pressed: listing what is
  // missing from a form nobody has filled in yet is nagging, not help.
  const [showBlockers, setShowBlockers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which button is mid-flight, so only that one shows its own spinner. Both
  // run the same save; they differ in where they are and what they set status to.
  const [busy, setBusy] = useState<"footer" | "header" | null>(null);
  const submitting = useRef(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const router = useRouter();

  /**
   * The screening coverage check, and the exact inputs it answered for.
   *
   * Held here rather than computed inside `stepBlockers` because it is a
   * network call to a model and that function is pure and runs every render.
   * `signature` is what makes "already checked" different from "checked
   * something else" — edit a question and the stored answer stops applying.
   */
  const [coverage, setCoverage] = useState<{
    signature: string;
    result: ScreeningCoverageResult;
  } | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  /**
   * Set when the check itself could not run, and — when creating — the ONLY way
   * past a coverage finding. There is deliberately no "continue anyway" on a
   * new campaign: a rubric dimension no question probes scores zero for every
   * candidate, and the recruiter has two real fixes — ask about it, or take it
   * out of the rubric. Neither is onerous and both leave the campaign honest,
   * so the wizard asks for one of them. (Editing a campaign that already exists
   * is the other case; see `coverageAcknowledged` below.)
   *
   * A failed CHECK is a different thing from a finding: OpenAI being down says
   * nothing about the questions, and must never stop a campaign being created.
   * That path advances with a visible note rather than a silent pass.
   */
  const [coverageFailed, setCoverageFailed] = useState(false);
  /**
   * Read-and-continue, and it exists ONLY when editing.
   *
   * At creation a gap is a mistake being made, and the two fixes — ask about
   * the dimension, or take it out of the rubric — are seconds of work, so there
   * is no override. On a campaign that is already live the same finding is
   * advice: the recruiter has reasons the app cannot see, candidates may already
   * have answered the questions as they stand, and refusing to save an unrelated
   * change over a model's reading would be the app second-guessing a person.
   */
  const [coverageAcknowledged, setCoverageAcknowledged] = useState(false);

  const step = WIZARD_STEPS[current];
  const rail = wizardRail(editing);
  const screeningDimensions = dimensionsFor(draft, "screening_q");
  const coverageSignatureNow = coverageSignature(
    screeningDimensions,
    draft.screeningQuestions,
  );
  const currentCoverage =
    coverage?.signature === coverageSignatureNow ? coverage.result : null;
  // Creating folds coverage in with the rest, so it reads as one list of things
  // owed. Editing keeps it out and renders it separately, because it is the one
  // finding there that can be waved through.
  const blockers = stepBlockers(draft, step.key, editing ? null : currentCoverage);
  const coverageGaps =
    editing && step.key === "rubric" && currentCoverage
      ? coverageBlockers(currentCoverage)
      : [];
  const reachable = furthestReachable(draft, current);

  const patch: Patch = (changes) => {
    setDraft((d) => ({ ...d, ...changes }));
    setShowBlockers(false);
    // A change may have opened a different gap, so a previous "I have read
    // this" stops applying. `coverageSignature` already retires the stale
    // result; this retires the stale acknowledgement with it.
    setCoverageAcknowledged(false);
  };

  function goTo(index: number) {
    if (index < 0 || index > LAST || index > reachable) return;
    setCurrent(index);
    setShowBlockers(false);
    // The document scrolls now, so a new step has to be brought back to its own
    // heading — otherwise a long step leaves the next one opening mid-page.
    window.scrollTo({ top: 0 });
  }

  /**
   * Leaving the rubric step is where coverage is checked, because it is the one
   * moment the rubric and the questions have both just been written and are
   * still on screen. One press does the whole thing: check, and either advance
   * (clean) or stop and show the gaps.
   *
   * Three ways through, and all of them end in the recruiter being able to
   * proceed: covered, overridden after reading, or the check could not run.
   * The only thing that is never allowed is claiming everything is covered
   * without having looked.
   */
  async function goNext() {
    if (blockers.length > 0) {
      setShowBlockers(true);
      return;
    }

    if (coverageGaps.length > 0 && !coverageAcknowledged) {
      setShowBlockers(true);
      return;
    }

    const needsCoverageCheck =
      step.key === "rubric" &&
      !coverageFailed &&
      coverage?.signature !== coverageSignatureNow;

    if (needsCoverageCheck) {
      setCheckingCoverage(true);
      try {
        const result = await checkScreeningCoverage({
          dimensions: screeningDimensions.map((d) => ({
            id: d.id,
            name: d.name,
          })),
          questions: draft.screeningQuestions.map((q) => ({ prompt: q.prompt })),
        });
        setCoverage({ signature: coverageSignatureNow, result });
        if (result.uncoveredDimensions.length > 0) {
          // Stop either way — the finding is worth reading. Creating cannot get
          // past it; editing can, with the panel's own Continue button.
          setShowBlockers(true);
          return;
        }
      } catch {
        // Fail open, but visibly: the step renders a note saying the check did
        // not run, so nobody reads a silent pass as a clean bill of health.
        setCoverageFailed(true);
      } finally {
        setCheckingCoverage(false);
      }
    }

    goTo(current + 1);
  }

  /**
   * The one write path, for both modes and both buttons.
   *
   * Editing posts the SAME payload creating does — `draftToFormData` is the
   * only place the shape is written down, so a field cannot be saved on
   * creation and quietly dropped on edit.
   */
  async function save(
    status: CampaignDraft["status"],
    which: "footer" | "header",
    /**
     * Only meaningful when creating. Finishing the wizard lands on the share
     * stage — the campaign now has an apply link, and handing it over is the
     * next thing anyone does. "Save draft" is the opposite intent ("I will come
     * back to this"), so it goes to the campaign itself.
     */
    finish: CreateCampaignFinish = "campaign",
  ) {
    // A ref, not the `busy` state: two activations inside one tick both read
    // the pre-render state and would both call through, creating two
    // campaigns. The disabled attribute has the same hole.
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setBusy(which);
    try {
      const payload = draftToFormData({ ...draft, status });
      if (campaign) {
        await updateCampaign(campaign.id, payload);
      } else {
        await createCampaign(payload, finish);
      }
    } catch (err) {
      // A SUCCESSFUL save ends in `redirect()`, and Next signals that by
      // throwing. Landing here does not mean the save failed — without this
      // line the form paints "NEXT_REDIRECT" over itself for the beat before
      // the navigation lands, reporting a failure for the one case that
      // actually worked. `unstable_rethrow` puts Next's own control-flow
      // errors back on the stack and returns normally for a real one.
      unstable_rethrow(err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
      // Only on failure: a success navigates away, and releasing the latch
      // there would let a stray second submit fire during the transition.
      submitting.current = false;
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Enter in a text field submits the form. Before the last step that means
    // "next", not "create a campaign I haven't finished describing".
    if (current < LAST) {
      void goNext();
      return;
    }
    void save(draft.status, "footer", "share");
  }


  /**
   * Anything typed is worth a confirmation before the X throws it away — asked
   * in an in-app modal rather than `window.confirm`, which renders as an
   * unstyled OS dialog and cannot say what is actually about to be lost.
   *
   * An untouched draft closes straight away: a confirmation nobody needs is the
   * fastest way to teach people to dismiss confirmations without reading them.
   */
  function confirmDiscard(e: React.MouseEvent) {
    if (JSON.stringify(draft) === JSON.stringify(initialDraft)) return;

    e.preventDefault();
    setShowDiscard(true);
  }

  const roleComplete = canLeaveStep(draft, "role");
  /** Where the X goes: back to the campaign being edited, or to the list. */
  const exitHref = campaign ? `/campaigns/${campaign.id}` : "/campaigns";

  return (
    <form
      id="wizard"
      onSubmit={handleSubmit}
      className="min-h-screen bg-[#FAFAFA] text-ink"
    >
      <WizardBrandHeader>
        {/* Creating: the only truthful "save draft" this product has — create
            the campaign now with status Draft, nothing public until it is set
            Active. Editing: the same escape hatch, but the campaign already
            exists, so it saves what is on screen at its current status rather
            than demoting a live campaign to Draft. Either way it is the way
            out that does not require walking to step five. */}
        <button
          type="button"
          onClick={() => void save(editing ? draft.status : "draft", "header")}
          disabled={!roleComplete || busy !== null}
          title={
            !roleComplete
              ? "A title and description first — a campaign cannot be saved without them"
              : editing
                ? "Save what you have changed so far and return to the campaign"
                : "Create it now as a Draft — nothing goes public, and you can finish the rest on the campaign page"
          }
          className="min-h-10 cursor-pointer rounded-lg px-[13px] text-[13px] font-semibold text-[#6B7280] transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-[#D1D5DB]"
        >
          {busy === "header" ? "Saving…" : editing ? "Save changes" : "Save draft"}
        </button>

        <WizardCloseLink
          href={exitHref}
          onClick={confirmDiscard}
          label={editing ? "Close without saving" : "Close and return to campaigns"}
        />
      </WizardBrandHeader>

      <div className="mx-auto w-full max-w-[760px] px-6 pb-20 pt-8">
        <WizardRail stages={rail}>
          {(s, i) => {
            // The share stage is always ahead and never clickable: it is not a
            // form, and there is nothing to show on it until the campaign row
            // exists. It is drawn anyway so the rail's length is honest from
            // step one — see `wizardRail`.
            const position = s.form ? stepPosition(i, current) : "ahead";
            const enabled = s.form && i <= reachable;
            const label = (
              <span
                className={`hidden truncate text-[13px] sm:inline ${
                  position === "current"
                    ? "font-semibold text-ink"
                    : "font-medium text-[#6B7280]"
                }`}
              >
                {s.label}
              </span>
            );

            if (!s.form) {
              // A span, not a disabled button: a disabled control swallows its
              // own hover in some browsers, so the one thing this mark owes the
              // recruiter — saying why it cannot be opened yet — would never be
              // readable.
              return (
                <span
                  title="The apply link only exists once the campaign is created, so this comes last."
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2"
                >
                  <StepMark index={i} position={position} />
                  {label}
                </span>
              );
            }

            return (
              <button
                type="button"
                onClick={() => goTo(i)}
                disabled={!enabled}
                aria-current={position === "current" ? "step" : undefined}
                className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150 ${
                  enabled ? "cursor-pointer hover:bg-[#F1F2F4]" : "cursor-not-allowed"
                }`}
              >
                <StepMark index={i} position={position} />
                {label}
              </button>
            );
          }}
        </WizardRail>

        <main className="mt-8">
          {/* The task, then where you are in it. On an edit the task is the
              campaign's own name — a recruiter with three tabs open needs the
              page to say which campaign this is. */}
          <p className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B7280]">
            {campaign ? campaign.title : "New campaign"} ·{" "}
            {progressLabel(current, rail.length)}
          </p>
          <h1 className="mb-6 font-heading text-[30px] font-semibold tracking-[-0.02em]">
            {step.title}
          </h1>

          {step.key === "role" && <StepRole draft={draft} patch={patch} />}
          {step.key === "rules" && <StepRules draft={draft} patch={patch} />}
          {step.key === "rubric" && <StepRubric draft={draft} patch={patch} />}
          {step.key === "team" && <StepTeam draft={draft} patch={patch} />}
          {step.key === "review" && <StepReview draft={draft} />}

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

          {/* The same finding as the blocker above, but on a campaign that is
              already live, where it is advice rather than a gate. It still
              stops the first Next — a warning nobody is made to read is one
              nobody reads — and then gets out of the way. */}
          {showBlockers && coverageGaps.length > 0 && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[22px] py-4"
            >
              <p className="mb-2 text-[13px] font-semibold text-[#92400E]">
                {coverageGaps.length === 1
                  ? "One rubric dimension may have no question"
                  : `${coverageGaps.length} rubric dimensions may have no question`}
              </p>
              <ul className="mb-3 flex list-disc flex-col gap-1.5 pl-5">
                {coverageGaps.map((gap) => (
                  <li key={gap} className="text-[13px] leading-[1.55] text-[#92400E]">
                    {gap}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setCoverageAcknowledged(true);
                  setShowBlockers(false);
                  goTo(current + 1);
                }}
                className="min-h-9 cursor-pointer rounded-lg border border-[#FDE68A] bg-white px-3 text-[13px] font-semibold text-[#92400E] transition-colors duration-150 hover:bg-[#FFFBEB]"
              >
                Continue anyway
              </button>
            </div>
          )}

          {/* Not "everything is fine" — the check did not run. Saying nothing
              here would let a technical failure read as a clean result. */}
          {step.key === "rubric" && coverageFailed && (
            <p className="mt-4 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-[22px] py-4 text-[13px] text-[#4B5563]">
              Question coverage could not be checked just now, so this campaign was
              not reviewed for gaps. Worth re-reading your questions against the
              rubric before candidates start.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-[22px] py-4 text-[13px] text-[#B91C1C]"
            >
              {error}
            </p>
          )}
        </main>

        <div className="mt-8 flex items-center gap-3 border-t border-[#E5E7EB] pt-6">
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
            <span className="text-[13px] text-[#6B7280]">
              {progressLabel(current, rail.length)}
            </span>

            {/* Distinct keys, and they are load-bearing. Without them React
                sees one <button> at one position and reconciles Next INTO
                Create campaign: same DOM node, patched attributes, focus
                intact. A held Enter (or a fast double click) then activates
                the node a second time — by which point it is type="submit" —
                and the campaign is created from step 4 without the recruiter
                ever seeing the review step. Separate keys force an unmount and
                a fresh mount, so the activation cannot carry over. */}
            {current < LAST ? (
              <button
                key="next"
                type="button"
                onClick={() => void goNext()}
                disabled={checkingCoverage}
                className="inline-flex min-h-[46px] cursor-pointer items-center gap-[9px] rounded-lg border border-ink bg-ink px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {checkingCoverage ? "Checking coverage…" : "Next"}
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            ) : (
              <button
                key="create"
                type="submit"
                disabled={busy !== null}
                className="min-h-[46px] cursor-pointer rounded-lg border border-ink bg-ink px-[22px] text-sm font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "footer"
                  ? editing
                    ? "Saving…"
                    : "Creating…"
                  : editing
                    ? "Save changes"
                    : "Create campaign"}
              </button>
            )}
          </span>
        </div>
      </div>
      {/* Portals to <body>, so living inside the <form> costs nothing — and
          every button in it is type="button" by default, which is why the
          Button primitive's default matters here. */}
      <Modal open={showDiscard} onClose={() => setShowDiscard(false)}>
        <ModalHeader>
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEF3C7] text-[#B45309]"
              aria-hidden="true"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">
                {editing
                  ? "Leave without saving your changes?"
                  : "Leave without creating this campaign?"}
              </h3>
              {/* Names what is lost. "Are you sure?" makes the reader do the
                  recall; the dialog already knows the answer. */}
              <p className="mt-1 text-sm leading-[1.55] text-[#6B7280]">
                {editing
                  ? "Your edits will be discarded. The campaign stays exactly as it was."
                  : `${discardSummary(draft)} will be discarded. Nothing has been saved yet.`}
              </p>
              <p className="mt-2 text-sm leading-[1.55] text-[#6B7280]">
                {editing ? (
                  <>
                    To keep them, close this and use{" "}
                    <strong className="font-semibold text-ink">Save changes</strong> — it
                    saves from wherever you are, without walking to the last step.
                  </>
                ) : (
                  <>
                    To keep it, close this and use{" "}
                    <strong className="font-semibold text-ink">Save draft</strong> — it
                    creates the campaign as a Draft, so nothing goes public and you can
                    finish the rest later.
                  </>
                )}
              </p>
            </div>
          </div>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setShowDiscard(false)}>
            Keep editing
          </Button>
          {/* Outlined, not filled: the design system draws destructive actions
              as `danger`, which is an outline rather than a red block. */}
          <Button variant="danger" size="sm" onClick={() => router.push(exitHref)}>
            Discard
          </Button>
        </ModalFooter>
      </Modal>
    </form>
  );
}
