import type { SlaTimer, SlaStage } from "@/lib/constants";

export type SlaBreachLevel = "alert" | "escalation";

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
