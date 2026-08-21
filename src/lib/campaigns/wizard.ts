import {
  DEFAULT_SCORE_THRESHOLD,
  type AutomationMode,
  type CampaignReviewer,
  type CampaignStatusSelection,
  type EvaluationRubric,
  type InterviewPersona,
  type PipelineStage,
  type RubricDimension,
  type SlaTimer,
} from "@/lib/constants";

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
  blurb: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  {
    key: "role",
    label: "Role",
    title: "What are you hiring for?",
    blurb:
      "Candidates read everything on this screen. It is also what the AI drafts the rubric from, so specifics pay off twice.",
  },
  {
    key: "rules",
    label: "Rules",
    title: "How much may the AI do alone?",
    blurb:
      "Two of these settings decide whether a person sees a candidate before the system acts on them.",
  },
  {
    key: "rubric",
    label: "Rubric",
    title: "What counts as a good candidate?",
    blurb:
      "Mark each criterion must-have or nice-to-have and how much it matters. Weighting is derived from that — there are no numbers to tune.",
  },
  {
    key: "team",
    label: "Team & timing",
    title: "Who reviews, and how fast?",
    blurb:
      "Both are optional — you can add them later. Timers only alert a person; they never advance or reject anyone.",
  },
  {
    key: "review",
    label: "Review",
    title: "This is what will run",
    blurb:
      "Two steps happen automatically, three wait for a person. Check the line between them before you create.",
  },
];

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

export function dimensionsFor(
  draft: CampaignDraft,
  stage: PipelineStage,
): RubricDimension[] {
  return draft.rubrics.find((r) => r.stage === stage)?.dimensions ?? [];
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

export function progressLabel(current: number): string {
  return `Step ${current + 1} of ${WIZARD_STEPS.length}`;
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
 */
export function stepBlockers(draft: CampaignDraft, key: WizardStepKey): string[] {
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
    const unnamed = draft.rubrics.flatMap((r) =>
      r.dimensions.filter((d) => d.name.trim().length === 0),
    );
    if (unnamed.length > 0) {
      blockers.push(
        unnamed.length === 1
          ? "A name on every dimension — one unnamed dimension discards the whole rubric on save."
          : `Names on ${unnamed.length} dimensions — an unnamed one discards the whole rubric on save.`,
      );
    }
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

// ─── Before you create ───────────────────────────────────────────────────────

export interface PreflightItem {
  label: string;
  done: boolean;
  /** Which step fixes it — the rail's Edit link. */
  step: WizardStepKey;
}

/**
 * The checklist on the last step. Items are things that are *true or not yet*,
 * never blockers — anything that would refuse a save is a `stepBlocker` and
 * never gets this far.
 */
export function draftPreflight(draft: CampaignDraft): PreflightItem[] {
  const resume = resumeDimensionCount(draft);
  return [
    {
      label: "Title and description",
      done: draft.title.trim().length > 0 && draft.description.trim().length >= 10,
      step: "role",
    },
    {
      label:
        resume > 0
          ? `Resume rubric · ${resume} ${resume === 1 ? "dimension" : "dimensions"}`
          : "Resume rubric · no dimensions, so no CV is scored",
      done: resume > 0,
      step: "rubric",
    },
  ];
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
  fd.set("deadline_enforced", draft.deadlineEnforced ? "true" : "false");

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
  fd.set("rubrics_json", JSON.stringify(draft.rubrics));
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
