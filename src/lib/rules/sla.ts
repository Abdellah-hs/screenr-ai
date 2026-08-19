import type {
  CandidateStage,
  SlaBreachLevel,
  SlaTimer,
  SlaStage,
} from "@/lib/constants";

export type { SlaBreachLevel };

/**
 * Hours an application has sat in its current stage. We use `updated_at` (bumped
 * on every transition/score write) as the "entered stage / last activity"
 * proxy — there is no dedicated `entered_at` column — which is exactly the
 * signal SLA "stuck candidate" detection wants: nothing has moved in N hours.
 */
export function hoursInStage(updatedAt: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(updatedAt).getTime()) / 3_600_000;
}

/**
 * The SLA breach level for an application sitting `hours` in `stage`, given the
 * campaign's timers. Escalation outranks alert; returns null when the campaign
 * has no timer for that stage or neither threshold is crossed. Pure.
 */
export function slaBreachLevel(
  stage: SlaStage,
  hours: number,
  timers: SlaTimer[],
): SlaBreachLevel | null {
  const timer = timers.find((t) => t.stage === stage);
  if (!timer) return null;
  if (hours >= timer.escalation_threshold_hours) return "escalation";
  if (hours >= timer.alert_threshold_hours) return "alert";
  return null;
}

/**
 * The SLA stage a pipeline bucket maps to, or null when the SLA does not apply.
 *
 * `hired` and `rejected` are terminal: the candidate has stopped moving because
 * a decision was made, which is the opposite of the "stuck" condition an SLA
 * exists to catch. Flagging them would fill the overdue list with people nobody
 * is waiting on, and a filter that is mostly noise stops being read.
 *
 * A `Record` rather than a filtered list so adding a pipeline stage without
 * deciding whether it has an SLA is a type error rather than a silent `null`.
 */
const SLA_STAGE_FOR: Record<CandidateStage, SlaStage | null> = {
  applied: "applied",
  screening: "screening",
  interview: "interview",
  final_interview: "final_interview",
  hired: null,
  rejected: null,
};

export function slaStageFor(stage: CandidateStage): SlaStage | null {
  return SLA_STAGE_FOR[stage];
}

export interface SlaStatus {
  level: SlaBreachLevel;
  /** Whole hours the application has sat in this stage, for the tooltip. */
  hours: number;
}

/**
 * Whether one application is overdue, and by how much.
 *
 * The single definition of "overdue" — the notification bell's counts and the
 * candidate table's badge both go through it, so the filter surfaces exactly
 * the applications the bell counted. Two implementations of the same predicate
 * is how a recruiter ends up tapping a bell that says four and landing on a
 * list that shows three.
 */
export function applicationSlaStatus(
  stage: CandidateStage,
  updatedAt: string,
  timers: SlaTimer[],
  now: Date = new Date(),
): SlaStatus | null {
  const slaStage = slaStageFor(stage);
  if (!slaStage) return null;

  const hours = hoursInStage(updatedAt, now);
  const level = slaBreachLevel(slaStage, hours, timers);
  if (!level) return null;

  return { level, hours: Math.floor(hours) };
}
