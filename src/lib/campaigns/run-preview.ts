import {
  INTERVIEW_PERSONAS,
  type AutomationMode,
  type CampaignStatusSelection,
  type InterviewPersona,
  type SlaTimer,
} from "@/lib/constants";

/**
 * Who moves the pipeline at each step.
 *
 * `blocked` is not a failure — it is the honest answer for a step that cannot
 * run yet given the settings, and it is the one the form is worst at conveying
 * on its own (a Draft campaign looks fully configured and does nothing).
 */
export type RunActor = "automatic" | "person" | "candidate" | "blocked";

export interface RunStep {
  title: string;
  detail: string;
  actor: RunActor;
}

export interface RunConfig {
  status: CampaignStatusSelection;
  automationMode: AutomationMode;
  screeningThreshold: number;
  /** Dimensions on the resume rubric — zero means nothing gets scored. */
  resumeDimensions: number;
  interviewPersona: InterviewPersona;
  slaTimers: SlaTimer[];
  slotMinutes: number;
  horizonDays: number;
}

function applyLinkStep(status: CampaignStatusSelection): RunStep {
  switch (status) {
    case "active":
      return {
        title: "The apply link goes live",
        detail:
          "Anyone with the link can apply, and their CV enters this pipeline straight away.",
        actor: "automatic",
      };
    case "active_no_intake":
      return {
        title: "The apply link stays closed",
        detail:
          "Active, but intake is off — the apply page turns people away. Everyone already in the pipeline keeps moving.",
        actor: "blocked",
      };
    case "paused":
      return {
        title: "The apply link stays closed",
        detail:
          "Paused freezes the pipeline: nobody new gets in, and nobody inside is progressed or rejected.",
        actor: "blocked",
      };
    case "closed":
      return {
        title: "The apply link stays closed",
        detail: "Closed campaigns accept nobody and run nothing.",
        actor: "blocked",
      };
    default:
      return {
        title: "The apply link stays dark",
        detail:
          "Not yet — status is Draft. Nothing is public, scored, or sent until you set it Active.",
        actor: "blocked",
      };
  }
}

function scoringStep(config: RunConfig): RunStep {
  if (config.resumeDimensions === 0) {
    return {
      title: "Nothing scores the CVs",
      detail:
        "The resume rubric has no dimensions, so CVs arrive unscored and every one waits for you.",
      actor: "blocked",
    };
  }

  const against = `Against ${config.resumeDimensions} resume ${
    config.resumeDimensions === 1 ? "dimension" : "dimensions"
  }.`;

  return {
    title: "The AI scores each CV",
    detail:
      config.automationMode === "fully_auto"
        ? `${against} Below ${config.screeningThreshold} is auto-rejected, with the score, the rationale and the rule that fired kept on the record.`
        : `${against} The score sorts your queue and rejects nobody in this mode.`,
    actor: "automatic",
  };
}

function approvalStep(config: RunConfig): RunStep {
  return config.automationMode === "human_in_loop"
    ? {
        title: "A person approves each CV into screening",
        detail:
          "Human-in-the-loop: you see every CV before a screening link is sent. Nothing goes out until you approve it.",
        actor: "person",
      }
    : {
        title: "Screening sends itself",
        detail: `Anyone scoring ${config.screeningThreshold} or above is sent a screening link without a person approving it.`,
        actor: "automatic",
      };
}

function screeningStep(config: RunConfig): RunStep {
  const persona =
    INTERVIEW_PERSONAS.find((p) => p.value === config.interviewPersona)?.label ??
    config.interviewPersona;

  const alerts = config.slaTimers.length
    ? `${config.slaTimers.length} SLA ${
        config.slaTimers.length === 1 ? "timer alerts" : "timers alert"
      } you if anyone sits too long — they never advance or reject.`
    : "No SLA timers, so nothing will chase a candidate who stalls.";

  return {
    title: "Voice screening, then the AI interview",
    detail: `${persona} interviewer, available whenever the candidate is ready. ${alerts}`,
    actor: "candidate",
  };
}

function decisionStep(config: RunConfig): RunStep {
  return {
    title: "You decide the hire",
    detail: `${config.slotMinutes}-minute final slots, bookable ${config.horizonDays} days out. The three stage scores stay separate — no score is ever combined.`,
    actor: "person",
  };
}

/**
 * The pipeline these settings will actually run, in order.
 *
 * A create form shows fields; it does not show consequences. This turns the
 * settings back into the sequence a candidate will experience, so the two
 * questions the form cannot answer — what happens without me, and where does a
 * person have to act — are answerable before anything is saved.
 */
export function campaignRunSteps(config: RunConfig): RunStep[] {
  return [
    applyLinkStep(config.status),
    scoringStep(config),
    approvalStep(config),
    screeningStep(config),
    decisionStep(config),
  ];
}

const NUMBER_WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

function count(n: number): string {
  return NUMBER_WORD[n] ?? String(n);
}

/**
 * Where the line between machine and person falls, in one sentence. It is the
 * only number on the panel a recruiter is likely to act on: seeing "four steps
 * are automatic" is what sends someone back to the automation mode.
 */
export function runStepSummary(steps: RunStep[]): string {
  const automatic = steps.filter((s) => s.actor === "automatic").length;
  const people = steps.filter((s) => s.actor === "person").length;
  const blocked = steps.filter((s) => s.actor === "blocked").length;

  const parts = [
    `${count(automatic)} ${automatic === 1 ? "step runs" : "steps run"} without you`,
    `${people} ${people === 1 ? "waits" : "wait"} for a person`,
  ];
  if (blocked > 0) {
    parts.push(
      `${blocked} ${blocked === 1 ? "cannot run" : "cannot run"} with these settings`,
    );
  }

  return `${parts.join(", ")}.`;
}
