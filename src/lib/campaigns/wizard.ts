import { coverageBlockers, type ScreeningCoverageResult } from "@/lib/screening/coverage";
import { isTeamReviewersEnabled } from "@/lib/flags";
import {
  DEFAULT_SCORE_THRESHOLD,
  type AutomationMode,
  type Campaign,
  type CampaignReviewer,
  type CampaignStatusSelection,
  type EvaluationRubric,
  type InterviewPersona,
  type PipelineStage,
  type RubricDimension,
  type SlaTimer,
} from "@/lib/constants";
import { encodeStatusSelection } from "@/lib/rules/campaign-status";

/**
 * The new-campaign wizard, as data.
 *
 * Everything here is pure so the parts that can be wrong — what a step needs
 * before you may leave it, and what actually gets posted — are testable without
 * a browser. The component is then only wiring.
 */

export type WizardStepKey = "role" | "rules" | "rubric" | "team" | "review";

export interface WizardStep {
  key: WizardStepKey;
  /** Short label on the step rail. */
  label: string;
  /** The question this step answers, asked in the recruiter's words. */
  title: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  {
    key: "role",
    label: "Role",
    title: "What are you hiring for?",
  },
  {
    key: "rules",
    label: "Rules",
    title: "How much may the AI do alone?",
  },
  {
    key: "rubric",
    label: "Rubric",
    title: "What counts as a good candidate?",
  },
  {
    key: "team",
    // Named for what the step actually holds. Team reviewers sit behind
    // NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS, default off, so with the flag down
    // this step is SLA timers and interview availability and nothing else —
    // "Team &" labelled a section that is not rendered, and "Who reviews"
    // asked a question the step does not answer.
    label: isTeamReviewersEnabled() ? "Team & timing" : "Timing",
    title: isTeamReviewersEnabled() ? "Who reviews, and how fast?" : "How fast?",
  },
  {
    key: "review",
    label: "Review",
    title: "This is what will run",
  },
];

/**
 * The stage after the last form step.
 *
 * Deliberately NOT a member of `WIZARD_STEPS`. Every function in this module
 * that walks that array — `stepBlockers`, `canLeaveStep`, `furthestReachable` —
 * is about a form the recruiter can still get wrong, and this is not one: the
 * campaign already exists by the time anyone sees it. Adding a sixth entry
 * would move `LAST`, so the wizard's Create button would become a Next and the
 * campaign would never be written at all.
 *
 * It is drawn on the rail because it is genuinely the last thing creating a
 * campaign involves — the apply link does not exist until the row does, so
 * handing it over cannot happen any earlier than this.
 */
export const SHARE_STAGE = {
  label: "Share",
  title: "Now bring people to it",
} as const;

export interface RailStage {
  key: string;
  label: string;
  /**
   * A step of the form: one the recruiter can visit, get wrong, and come back
   * to. The share stage is not one, and the flag is what keeps it unclickable
   * and uncounted by everything that walks `WIZARD_STEPS`.
   */
  form: boolean;
}

/**
 * The marks on the rail, which is one longer than the form when creating.
 *
 * The share stage is drawn from step one, greyed and unreachable, because the
 * rail is a promise about how long the task is. Showing five and then landing
 * on a sixth changes that promise at the one moment the recruiter has already
 * committed — and a stage that appears only after the irreversible action reads
 * as something having gone wrong rather than as the flow finishing.
 *
 * Editing never reaches it (Save changes returns to the campaign), so an edit
 * rail stops at Review rather than dangling a stage that will not come.
 */
export function wizardRail(editing: boolean): RailStage[] {
  const steps: RailStage[] = WIZARD_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    form: true,
  }));

  if (editing) return steps;
  return [...steps, { key: "share", label: SHARE_STAGE.label, form: false }];
}

export const RUBRIC_STAGES: { key: PipelineStage; label: string }[] = [
  { key: "resume", label: "Resume" },
  { key: "screening_q", label: "Screening questions" },
  { key: "interview", label: "Interview" },
];

export const DEFAULT_SLOT_MINUTES = 45;
export const DEFAULT_HORIZON_DAYS = 14;

/**
 * Every answer the wizard collects, in one object.
 *
 * It has to live in the parent: each step unmounts when you leave it, so an
 * uncontrolled input's value would be destroyed by pressing Next and the final
 * submit would post an empty campaign. Nothing is read off the DOM.
 */
export interface CampaignDraft {
  title: string;
  description: string;
  department: string;
  positions: number;
  location: string;

  status: CampaignStatusSelection;
  deadline: string;
  /** false = the deadline is informational; true = it closes intake. */
  deadlineEnforced: boolean;

  automationMode: AutomationMode;
  resumeThreshold: number;
  screeningThreshold: number;
  interviewPersona: InterviewPersona;

  rubrics: EvaluationRubric[];
  /**
   * What the voice AI asks, in order. Collected here rather than after
   * creation so a campaign is never created in a state where nobody can be
   * approved into screening — the apply link goes live immediately.
   */
  screeningQuestions: { id?: string; prompt: string }[];
  reviewers: CampaignReviewer[];
  slaTimers: SlaTimer[];

  slotMinutes: number;
  horizonDays: number;
  /** Auto-detected from the calendar; carried so an edit never wipes it. */
  timezone: string;
}

function emptyRubric(stage: PipelineStage): EvaluationRubric {
  return {
    id: `rub-${stage}`,
    campaign_id: "",
    stage,
    version: 1,
    is_active: true,
    dimensions: [],
    created_at: new Date(0).toISOString(),
    archived_at: null,
  };
}

export function emptyDraft(): CampaignDraft {
  return {
    title: "",
    description: "",
    department: "",
    positions: 1,
    location: "",

    status: "draft",
    deadline: "",
    deadlineEnforced: false,

    automationMode: "human_in_loop",
    resumeThreshold: DEFAULT_SCORE_THRESHOLD,
    screeningThreshold: DEFAULT_SCORE_THRESHOLD,
    interviewPersona: "neutral",

    rubrics: RUBRIC_STAGES.map((s) => emptyRubric(s.key)),
    screeningQuestions: [],
    reviewers: [],
    slaTimers: [],

    slotMinutes: DEFAULT_SLOT_MINUTES,
    horizonDays: DEFAULT_HORIZON_DAYS,
    timezone: "",
  };
}

/**
 * An existing campaign, as a draft the wizard can edit.
 *
 * Editing runs the SAME five steps as creating, because a recruiter who learnt
 * the campaign in one shape should not have to re-learn it in another to change
 * one number — and because a second form is a second place for a field to be
 * forgotten. The edit page used to be one long scroll with a different set of
 * controls, which is how it ended up with no screening-questions section at all
 * and a paragraph pointing somewhere else instead.
 *
 * Two fields need care:
 *
 * - `status` is stored as a lifecycle status plus an intake switch, but shown
 *   as one five-option dropdown. `encodeStatusSelection` is the inverse of what
 *   `parseCampaignFormData` does on the way back in, so a save round-trips.
 * - `deadline` is an ISO timestamp in the row and a `YYYY-MM-DD` string in a
 *   date input. Slicing keeps the stored day; parsing it as a Date would shift
 *   it by a day for anyone west of UTC.
 */
export function draftFromCampaign(
  campaign: Campaign,
  screeningQuestions: { id?: string; prompt: string }[] = [],
): CampaignDraft {
  return {
    title: campaign.title,
    description: campaign.description ?? "",
    department: campaign.department ?? "",
    positions: campaign.positions,
    location: campaign.location ?? "",

    status: encodeStatusSelection(campaign.status, campaign.accepting_applications),
    deadline: campaign.deadline ? campaign.deadline.slice(0, 10) : "",
    deadlineEnforced: campaign.deadline_enforced,

    automationMode: campaign.automation_mode,
    resumeThreshold: campaign.resume_threshold,
    screeningThreshold: campaign.screening_threshold,
    interviewPersona: campaign.interview_persona,

    // Seeded through the same helper the empty draft uses, so a campaign saved
    // before a stage existed still opens with a tab for it rather than a
    // missing one.
    rubrics: RUBRIC_STAGES.map(
      (s) =>
        campaign.rubrics.find((r) => r.stage === s.key) ?? emptyRubric(s.key),
    ),
    screeningQuestions: screeningQuestions.map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      prompt: q.prompt,
    })),
    reviewers: campaign.reviewers,
    slaTimers: campaign.sla_timers,

    slotMinutes: campaign.interview_slot_minutes ?? DEFAULT_SLOT_MINUTES,
    horizonDays: campaign.interview_booking_horizon_days ?? DEFAULT_HORIZON_DAYS,
    // Auto-detected from the calendar and never shown. Carried so a save does
    // not wipe what an earlier one detected.
    timezone: campaign.interview_timezone ?? "",
  };
}

export function dimensionsFor(
  draft: CampaignDraft,
  stage: PipelineStage,
): RubricDimension[] {
  return draft.rubrics.find((r) => r.stage === stage)?.dimensions ?? [];
}

/**
 * Which stages carry a dimension with no name, given a set of rubrics.
 *
 * Named by STAGE, because every editor of these shows one tab at a time: "one
 * unnamed dimension" with no stage sends a recruiter hunting through tabs for
 * a blank field they cannot see from where they are standing — which is
 * exactly what happens after the AI fills all three rubrics at once.
 *
 * The rule is load-bearing rather than cosmetic: `draftToFormData` drops blank
 * rows as a backstop, and `safeParseJsonArray` swallows a parse failure and
 * returns `[]`, so an unnamed row that reaches the wire can cost a recruiter
 * their whole rubric. It had three implementations — the wizard blocker, that
 * backstop, and the in-place edit modal, which is the only guard on the
 * `saveCampaignRubrics` path.
 */
export function unnamedRubricStages(
  rubrics: EvaluationRubric[],
): { key: PipelineStage; label: string; count: number }[] {
  return RUBRIC_STAGES.map((stage) => ({
    ...stage,
    count: (rubrics.find((r) => r.stage === stage.key)?.dimensions ?? []).filter(
      (d) => d.name.trim().length === 0,
    ).length,
  })).filter((stage) => stage.count > 0);
}

export function resumeDimensionCount(draft: CampaignDraft): number {
  return dimensionsFor(draft, "resume").length;
}

// ─── Step position ───────────────────────────────────────────────────────────

export type StepPosition = "current" | "past" | "ahead";

export function stepPosition(index: number, current: number): StepPosition {
  if (index === current) return "current";
  return index < current ? "past" : "ahead";
}

export function stepIndex(key: WizardStepKey): number {
  return WIZARD_STEPS.findIndex((s) => s.key === key);
}

/**
 * `stages` is passed in rather than read off `WIZARD_STEPS` so the count can
 * never disagree with the rail beside it — creating a campaign draws six marks
 * and must say "of 6", editing draws five and must say "of 5".
 */
export function progressLabel(current: number, stages: number): string {
  return `Step ${current + 1} of ${stages}`;
}

// ─── What a step needs before you may leave it ───────────────────────────────

/**
 * Why Next is refused, in the sentences the recruiter is shown.
 *
 * Two of these are not style preferences. `rubricSchema` requires a non-empty
 * name on every dimension, and `safeParseJsonArray` swallows a parse failure
 * and returns `[]` — so one unnamed dimension silently discards the entire
 * rubric on save. And a timer whose escalation lands after its limit can never
 * escalate. Both are caught here, while there is still a field to fix.
 *
 * `coverage` is passed IN rather than computed here, and that is not an
 * accident of plumbing: this function is pure and the component calls it on
 * every render, while a coverage check is a network round-trip to a model.
 * Computing it here would either make the whole module async and untestable
 * without a browser, or fire an AI call per keystroke. The component runs the
 * check at a checkpoint and hands the answer down.
 */
export function stepBlockers(
  draft: CampaignDraft,
  key: WizardStepKey,
  coverage?: ScreeningCoverageResult | null,
): string[] {
  const blockers: string[] = [];

  if (key === "role") {
    if (draft.title.trim().length === 0) {
      blockers.push("A role title — it is the name candidates and your team see.");
    }
    if (draft.description.trim().length < 10) {
      blockers.push(
        "A description. The AI drafts the rubric from it, and candidates read it verbatim.",
      );
    }
    if (!Number.isInteger(draft.positions) || draft.positions < 1) {
      blockers.push("At least one open position.");
    }
  }

  if (key === "rules") {
    const t = draft.screeningThreshold;
    if (!Number.isInteger(t) || t < 0 || t > 100) {
      blockers.push("A screening threshold between 0 and 100.");
    }
  }

  if (key === "rubric") {
    // Named by STAGE, because the editor shows one tab at a time and this
    // scans all three. "One unnamed dimension" with no stage sends a recruiter
    // hunting through tabs for a blank field they cannot see from where they
    // are standing — which is exactly what happens after the AI fills all
    // three rubrics at once.
    for (const stage of unnamedRubricStages(draft.rubrics)) {
      blockers.push(
        stage.count === 1
          ? `A name on the empty dimension in the ${stage.label} rubric, or remove the row.`
          : `Names on ${stage.count} empty dimensions in the ${stage.label} rubric, or remove the rows.`,
      );
    }

    // Unlike every other blocker here, this one is a model's reading rather
    // than a fact about the draft — which is why the component offers a way
    // past it, and why an absent result (never checked, or the check failed)
    // adds nothing. A configuration warning must not become an outage.
    if (coverage) blockers.push(...coverageBlockers(coverage));
  }

  if (key === "team") {
    for (const reviewer of draft.reviewers) {
      if (reviewer.email.trim().length === 0) {
        blockers.push("An email address on every reviewer, or remove the row.");
        break;
      }
    }

    for (const timer of draft.slaTimers) {
      if (timer.time_limit_hours < 1) {
        blockers.push("A time limit of at least one hour on every timer.");
        break;
      }
      if (timer.escalation_threshold_hours > timer.time_limit_hours) {
        blockers.push(
          "An escalation threshold at or before the time limit — after it, it can never fire.",
        );
        break;
      }
      if (timer.alert_threshold_hours > timer.escalation_threshold_hours) {
        blockers.push("An alert threshold at or before the escalation threshold.");
        break;
      }
    }

    if (draft.slotMinutes < 5 || draft.slotMinutes > 240) {
      blockers.push("A final-interview slot between 5 and 240 minutes.");
    }
    if (draft.horizonDays < 1 || draft.horizonDays > 90) {
      blockers.push("A booking horizon between 1 and 90 days.");
    }
  }

  return blockers;
}

export function canLeaveStep(draft: CampaignDraft, key: WizardStepKey): boolean {
  // Coverage is deliberately not consulted. This drives the step rail, and a
  // coverage gap must never make a step unreachable — the recruiter has to be
  // able to walk back to the questions to fix the very thing being warned
  // about. Only the explicit Next press weighs it.
  return stepBlockers(draft, key).length === 0;
}

/**
 * The furthest step the rail may jump to.
 *
 * Back is always free — a wizard that traps you is worse than one that lets you
 * skip. Forward stops at the first step that still owes something, so the rail
 * can never land you on Review with a campaign that will not save.
 */
export function furthestReachable(draft: CampaignDraft, current: number): number {
  let reachable = 0;
  while (reachable < WIZARD_STEPS.length - 1) {
    if (!canLeaveStep(draft, WIZARD_STEPS[reachable].key)) break;
    reachable += 1;
  }
  return Math.max(reachable, current);
}

/**
 * What the recruiter would actually lose, in their own terms.
 *
 * A discard dialog that says "are you sure?" makes the reader reconstruct what
 * they typed; this dialog already knows. Only the two things worth naming are
 * counted — a title is the campaign's identity and the rubric is the part that
 * took real thought.
 */
export function discardSummary(draft: CampaignDraft): string {
  const dimensions = draft.rubrics.reduce((n, r) => n + r.dimensions.length, 0);
  const parts: string[] = [];

  if (draft.title.trim().length > 0) parts.push(`"${draft.title.trim()}"`);
  if (dimensions > 0) {
    parts.push(`${dimensions} rubric ${dimensions === 1 ? "dimension" : "dimensions"}`);
  }

  if (parts.length === 0) return "This draft";
  return parts.join(" and ");
}

// ─── Serialisation ───────────────────────────────────────────────────────────

/**
 * The draft as the payload `parseCampaignFormData` expects.
 *
 * The wizard cannot build this from the DOM the way a single-page form does:
 * at submit only the last step is mounted, so four fifths of the fields do not
 * exist as inputs. This is the one place the shape is written down, and the
 * only thing `createCampaign` ever receives from here.
 */
export function draftToFormData(draft: CampaignDraft): FormData {
  const fd = new FormData();

  fd.set("title", draft.title.trim());
  fd.set("description", draft.description);
  fd.set("department", draft.department.trim());
  fd.set("positions", String(draft.positions));
  fd.set("location", draft.location.trim());

  fd.set("status", draft.status);
  fd.set("deadline", draft.deadline);
  // Enforcement is meaningless without a date, and the wizard hides the choice
  // until one is set — so a draft can still carry `true` from a date that was
  // picked and then cleared. Normalising here rather than resetting on clear
  // keeps the recruiter's answer if they set a date again, while making sure
  // the campaign is never stored as enforcing a deadline it does not have.
  const enforced = draft.deadline.trim().length > 0 && draft.deadlineEnforced;
  fd.set("deadline_enforced", enforced ? "true" : "false");

  fd.set("automation_mode", draft.automationMode);
  // Two bars. Sending only one would silently leave the CV gate on its column
  // default while the recruiter believed they had set it.
  fd.set("resume_threshold", String(draft.resumeThreshold));
  fd.set("screening_threshold", String(draft.screeningThreshold));
  fd.set("interview_persona", draft.interviewPersona);

  fd.set("interview_slot_minutes", String(draft.slotMinutes));
  fd.set("interview_booking_horizon_days", String(draft.horizonDays));
  fd.set("interview_timezone", draft.timezone);

  // A stage with no dimensions is still sent, so re-saving an emptied rubric
  // clears it rather than leaving the previous version standing.
  // Blank-named dimensions are dropped rather than sent. `rubricSchema`
  // requires a name and `safeParseJsonArray` swallows the parse failure and
  // returns `[]`, so ONE unnamed dimension would silently discard all three
  // rubrics — the blocker above is meant to catch that first, but a guard whose
  // only backstop is another guard is one bad refactor from losing a recruiter's
  // whole rubric. A row with no name carries nothing, so dropping it costs
  // nothing; dropping the rubric costs everything.
  fd.set(
    "rubrics_json",
    JSON.stringify(
      draft.rubrics.map((r) => ({
        ...r,
        dimensions: r.dimensions.filter((d) => d.name.trim().length > 0),
      })),
    ),
  );
  fd.set("sla_timers_json", JSON.stringify(draft.slaTimers));
  fd.set("reviewers_json", JSON.stringify(draft.reviewers));
  // Only questions that would survive the server-side schema. safeParseJsonArray
  // drops the WHOLE array on any invalid element, so one half-typed question
  // would silently discard every good one with it.
  fd.set(
    "screening_questions_json",
    JSON.stringify(
      draft.screeningQuestions
        .map((q) => ({ prompt: q.prompt.trim() }))
        .filter((q) => q.prompt.length >= 10),
    ),
  );
  fd.set("availability_rules_json", JSON.stringify([]));

  return fd;
}
