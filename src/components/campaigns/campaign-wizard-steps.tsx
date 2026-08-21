"use client";

import {
  AUTOMATION_MODES,
  CAMPAIGN_STATUS_SELECTIONS,
  INTERVIEW_PERSONAS,
  type AutomationMode,
  type CampaignStatusSelection,
  type InterviewPersona,
} from "@/lib/constants";
import { campaignRunSteps, type RunActor, type RunStep } from "@/lib/campaigns/run-preview";
import {
  draftPreflight,
  resumeDimensionCount,
  type CampaignDraft,
  type WizardStepKey,
} from "@/lib/campaigns/wizard";
import { DescriptionField } from "./description-field";
import RubricEditor from "./rubric-editor";
import ScreeningQuestionsEditor from "./screening-questions-editor";
import SlaTimersEditor from "./sla-timers-editor";
import TeamReviewersEditor from "./team-reviewers-editor";
import InterviewAvailabilityEditor from "./interview-availability-editor";
import { SelectChevron } from "./editor-parts";
import { ActorMark } from "@/components/ui";
import { isTeamReviewersEnabled } from "@/lib/flags";
import { FIELD_BASE } from "@/components/ui/field";

/** One card. Same box on every step, so the eye never re-learns the page. */
const CARD =
  "rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

const LABEL = "mb-1.5 block text-[13px] font-semibold text-ink";
const HINT = "mt-[7px] text-xs leading-[1.5] text-[#6B7280]";

/** The artboard's own hexes are dropped here in favour of `FIELD_BASE`: one
 *  definition of what a field looks like is a repo rule, and the difference is
 *  a border shade nobody can name. Size is what actually varies. */
const FIELD = `${FIELD_BASE} min-h-11 text-sm`;
const FIELD_LG = `${FIELD_BASE} min-h-12 text-[15px]`;

export type Patch = (patch: Partial<CampaignDraft>) => void;

// ─── Step 1 · Role ───────────────────────────────────────────────────────────

export function StepRole({ draft, patch }: { draft: CampaignDraft; patch: Patch }) {
  return (
    <div className={`${CARD} flex flex-col gap-5`}>
      <div>
        <label htmlFor="title" className={LABEL}>
          Title <span className="text-[#DC2626]">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="e.g. Senior Frontend Engineer"
          className={FIELD_LG}
        />
      </div>

      <div>
        <DescriptionField
          value={draft.description}
          onChange={(description) => patch({ description })}
          rows={7}
        />
        <p className={HINT}>
          AI assist drafts this from a few details. It never invents salary,
          benefits or visa terms.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="department" className={LABEL}>
            Department
          </label>
          <input
            id="department"
            name="department"
            type="text"
            value={draft.department}
            onChange={(e) => patch({ department: e.target.value })}
            placeholder="e.g. Engineering"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="positions" className={LABEL}>
            Open positions
          </label>
          <input
            id="positions"
            name="positions"
            type="number"
            min={1}
            // 0 renders as an empty field so backspacing works; the step's
            // blocker is what insists on at least one position.
            value={draft.positions || ""}
            onChange={(e) => patch({ positions: parseInt(e.target.value) || 0 })}
            className={`${FIELD} tabular-nums`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="location" className={LABEL}>
          Location
        </label>
        <input
          id="location"
          name="location"
          type="text"
          value={draft.location}
          onChange={(e) => patch({ location: e.target.value })}
          placeholder="e.g. Remote, New York, NY"
          className={FIELD}
        />
      </div>
    </div>
  );
}

// ─── Step 2 · Rules ──────────────────────────────────────────────────────────

/** Today in the browser's timezone, so a deadline can't be set in the past. */
function todayLocalYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function StepRules({ draft, patch }: { draft: CampaignDraft; patch: Patch }) {
  const autoRejects = draft.automationMode === "fully_auto";

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <p className="mb-2.5 text-[13px] font-semibold text-ink">Automation mode</p>
        <div className="flex flex-col gap-2.5">
          {AUTOMATION_MODES.map((mode) => {
            const selected = draft.automationMode === mode.value;
            return (
              <label
                key={mode.value}
                htmlFor={`mode-${mode.value}`}
                className={`flex cursor-pointer gap-3 rounded-lg border p-[15px] transition-colors duration-150 ${
                  selected ? "border-ink" : "border-[#E5E7EB] hover:bg-[#F9FAFB]"
                }`}
              >
                <input
                  id={`mode-${mode.value}`}
                  type="radio"
                  name="automation_mode"
                  value={mode.value}
                  checked={selected}
                  onChange={() =>
                    patch({ automationMode: mode.value as AutomationMode })
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-ink"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {mode.label}
                  </span>
                  <span className="mt-[3px] block text-[13px] leading-[1.5] text-[#6B7280]">
                    {mode.value === "human_in_loop"
                      ? "A person approves every CV before a screening link is sent. The AI scores and waits."
                      : "The AI runs the pipeline on its own, within the threshold below."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className={`${CARD} flex flex-col gap-[18px]`}>
        {/* Two bars, and they grade different things: a resume ranking orders
            CVs against the rubric, a screening score grades spoken answers.
            One box would put both stages on the same fail line, which is the
            bug the split fixed. */}
        <div className="grid grid-cols-1 items-start gap-4 sm:[grid-template-columns:200px_minmax(0,1fr)]">
          <div>
            <label htmlFor="resume_threshold" className={LABEL}>
              Resume threshold
            </label>
            <input
              id="resume_threshold"
              name="resume_threshold"
              type="number"
              min={0}
              max={100}
              value={draft.resumeThreshold}
              onChange={(e) =>
                patch({ resumeThreshold: parseInt(e.target.value) || 0 })
              }
              className={`${FIELD} tabular-nums`}
            />
            {/* Says what it does not do as well. A missing must-have rejects in
                every mode, so "rejects nobody here" would be true of this
                number and false about the stage. */}
            <p className={HINT}>
              Ranking 0–100. A missing must-have rejects whatever this says.
            </p>
          </div>

          <div className="sm:col-span-2" />

          <div>
            <label htmlFor="screening_threshold" className={LABEL}>
              Screening threshold
            </label>
            <input
              id="screening_threshold"
              name="screening_threshold"
              type="number"
              min={0}
              max={100}
              value={draft.screeningThreshold}
              onChange={(e) =>
                patch({ screeningThreshold: parseInt(e.target.value) || 0 })
              }
              className={`${FIELD} tabular-nums`}
            />
            <p className={HINT}>Score 0–100</p>
          </div>

          {/* Amber only when it is true. In human-in-the-loop the threshold
              rejects nobody — dressing it as a warning in both modes would
              teach the recruiter to ignore the warning in the mode that has one. */}
          {autoRejects ? (
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-[15px] py-[13px]">
              <p className="mb-[5px] flex items-center gap-[7px] text-[13px] font-semibold text-[#92400E]">
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
                The one setting that rejects without a person
              </p>
              <p className="text-xs leading-[1.55] text-[#92400E]">
                A CV below {draft.screeningThreshold} is auto-rejected — with its
                score, rationale and the rule that fired kept on the record. Set 0
                to have a human see everyone.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-[15px] py-[13px]">
              <p className="mb-[5px] text-[13px] font-semibold text-ink">
                Nothing here rejects anyone
              </p>
              <p className="text-xs leading-[1.55] text-[#4B5563]">
                In human-in-the-loop the threshold only sorts your review queue.
                Switch to Fully Automatic above and it becomes the one setting
                that rejects a candidate without a person.
              </p>
            </div>
          )}
        </div>

        <div className="max-w-[400px]">
          <label htmlFor="interview_persona" className={LABEL}>
            Interview persona
          </label>
          <span className="relative block">
            <select
              id="interview_persona"
              name="interview_persona"
              value={draft.interviewPersona}
              onChange={(e) =>
                patch({ interviewPersona: e.target.value as InterviewPersona })
              }
              className={`${FIELD} cursor-pointer appearance-none pr-9`}
            >
              {INTERVIEW_PERSONAS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.description.toLowerCase()}
                </option>
              ))}
            </select>
            <SelectChevron />
          </span>
          <p className={HINT}>Tone only. It never changes what is scored.</p>
        </div>
      </section>

      <section className={`${CARD} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
        <div>
          <label htmlFor="status" className={LABEL}>
            Status
          </label>
          <span className="relative block">
            <select
              id="status"
              name="status"
              value={draft.status}
              onChange={(e) =>
                patch({ status: e.target.value as CampaignStatusSelection })
              }
              className={`${FIELD} cursor-pointer appearance-none pr-9`}
            >
              {CAMPAIGN_STATUS_SELECTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <SelectChevron />
          </span>
          <p className={HINT}>Draft keeps the apply link dark.</p>
        </div>

        <div>
          <label htmlFor="deadline" className={LABEL}>
            Deadline
          </label>
          <input
            id="deadline"
            name="deadline"
            type="date"
            min={todayLocalYmd()}
            suppressHydrationWarning
            value={draft.deadline}
            onChange={(e) => patch({ deadline: e.target.value })}
            className={FIELD}
          />

          <fieldset className="mt-3 border-0 p-0">
            <legend className="mb-[7px] p-0 text-xs font-semibold text-[#6B7280]">
              After the deadline passes
            </legend>
            {[
              { enforced: false, label: "Keep accepting", note: "(informational only)" },
              { enforced: true, label: "Stop accepting applications", note: "" },
            ].map((option) => (
              <label
                key={String(option.enforced)}
                htmlFor={`deadline-${option.enforced}`}
                className={`mb-2 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-[#E5E7EB] px-3 transition-colors duration-150 ${
                  draft.deadlineEnforced === option.enforced
                    ? "bg-[#F9FAFB]"
                    : "bg-white hover:bg-[#F9FAFB]"
                }`}
              >
                <input
                  id={`deadline-${option.enforced}`}
                  type="radio"
                  name="deadline_enforced"
                  value={String(option.enforced)}
                  checked={draft.deadlineEnforced === option.enforced}
                  onChange={() => patch({ deadlineEnforced: option.enforced })}
                  className="h-4 w-4 cursor-pointer accent-ink"
                />
                <span className="text-[13px] text-[#374151]">
                  {option.label}
                  {option.note && (
                    <span className="text-[#6B7280]"> {option.note}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </section>
    </div>
  );
}

// ─── Step 3 · Rubric ─────────────────────────────────────────────────────────

export function StepRubric({ draft, patch }: { draft: CampaignDraft; patch: Patch }) {
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <RubricEditor
          value={draft.rubrics}
          onChange={(rubrics) => patch({ rubrics })}
          description={draft.description}
        />
      </div>

      {/* Asked here rather than after the campaign exists. Approving anyone
          into screening needs questions, and the apply link goes live the
          moment the campaign does — so collecting them later means a campaign
          that can take applications it cannot act on. Still optional: a
          recruiter without a description yet cannot draft any, and blocking
          creation on that is worse than the banner on the campaign page. */}
      <ScreeningQuestionsEditor
        initialQuestions={[]}
        value={draft.screeningQuestions}
        onChange={(screeningQuestions) => patch({ screeningQuestions })}
        description={draft.description}
      />
    </div>
  );
}

// ─── Step 4 · Team & timing ──────────────────────────────────────────────────

export function StepTeam({ draft, patch }: { draft: CampaignDraft; patch: Patch }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Behind NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS, default off. Omitted rather
          than disabled: a greyed-out editor advertises a capability that does
          not exist yet. `createCampaign` drops the rows too. */}
      {isTeamReviewersEnabled() && (
        <section className={CARD}>
          <TeamReviewersEditor
            value={draft.reviewers}
            onChange={(reviewers) => patch({ reviewers })}
          />
        </section>
      )}

      <section className={CARD}>
        <SlaTimersEditor
          value={draft.slaTimers}
          onChange={(slaTimers) => patch({ slaTimers })}
        />
      </section>

      <section className={CARD}>
        <InterviewAvailabilityEditor
          value={{ slotMinutes: draft.slotMinutes, horizonDays: draft.horizonDays }}
          onChange={(next) =>
            patch({ slotMinutes: next.slotMinutes, horizonDays: next.horizonDays })
          }
        />
      </section>
    </div>
  );
}

// ─── Step 5 · Review ─────────────────────────────────────────────────────────

/**
 * Who moves each step, as a mark.
 *
 * `blocked` gets its own amber circle rather than a fourth `ActorMark` variant:
 * it is not an actor, it is the absence of one, and the three-actor primitive
 * only works because AI, System and Person are the whole set.
 */
function RunMark({ actor }: { actor: RunActor }) {
  if (actor === "blocked") {
    return (
      <span
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]"
        title="This step will not run with these settings"
        aria-label="Will not run"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636 5.636 18.364M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </span>
    );
  }

  // "candidate" means the candidate sits a stage the AI runs — voice screening
  // and the AI interview — so it wears the AI mark, not a fourth one.
  const MARK = { automatic: "system", person: "person", candidate: "ai" } as const;
  return <ActorMark actor={MARK[actor]} />;
}

export function StepReview({
  draft,
  onGoToStep,
}: {
  draft: CampaignDraft;
  onGoToStep: (key: WizardStepKey) => void;
}) {
  const steps: RunStep[] = campaignRunSteps({
    status: draft.status,
    automationMode: draft.automationMode,
    screeningThreshold: draft.screeningThreshold,
    resumeDimensions: resumeDimensionCount(draft),
    interviewPersona: draft.interviewPersona,
    slaTimers: draft.slaTimers,
    slotMinutes: draft.slotMinutes,
    horizonDays: draft.horizonDays,
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex flex-col px-6 py-[22px]">
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            return (
              <div key={step.title} className="flex gap-3.5">
                <span className="flex flex-none flex-col items-center">
                  <RunMark actor={step.actor} />
                  {!last && (
                    <span className="my-[5px] w-px flex-1 bg-[#E5E7EB]" aria-hidden="true" />
                  )}
                </span>
                <div className={last ? "" : "pb-4"}>
                  <p className="mb-0.5 text-sm font-semibold text-ink">{step.title}</p>
                  <p className="text-[13px] leading-[1.55] text-[#6B7280]">
                    {step.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="border-t border-[#F3F4F6] bg-ai-wash px-6 py-3.5 text-xs leading-[1.55] text-[#4B5563]">
          Change the automation mode on step 2 to move the line between automatic
          and human.
        </p>
      </section>

      <section className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
          Before you create
        </p>
        <div className="flex flex-col gap-2.5">
          {draftPreflight(draft).map((item) => (
            <p
              key={item.label}
              className="flex items-start gap-2.5 text-[13px] leading-[1.5] text-[#374151]"
            >
              <svg
                className={`mt-px h-4 w-4 shrink-0 ${
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
                  d={item.done ? "m5 13 4 4L19 7" : "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"}
                />
              </svg>
              <span className={item.done ? "" : "text-[#6B7280]"}>{item.label}</span>
              <button
                type="button"
                onClick={() => onGoToStep(item.step)}
                className="ml-auto cursor-pointer text-[13px] font-semibold text-primary hover:underline"
              >
                Edit
              </button>
            </p>
          ))}

          <p className="flex items-start gap-2.5 text-[13px] leading-[1.5] text-[#B45309]">
            <svg
              className="mt-px h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.25 11.25h1.5v5.25m-.75-8.25h.008v.008h-.008V8.25ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            Screening questions come after you create — nobody can be approved into
            screening until they exist.
          </p>
        </div>
      </section>
    </div>
  );
}
