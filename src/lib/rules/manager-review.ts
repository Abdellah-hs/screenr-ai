import type { ApplicationState } from "@/lib/constants";

/**
 * Rules for the manager review stage — the human decision point that closes the
 * pipeline.
 *
 * Everything before this is automated: a resume is parsed and scored, screening
 * is sent and scored, the AI interview runs and is scored. All of it stops at
 * `interview_scored` on purpose — the interview scoring rule is deliberately
 * record-only, because the PRD wants a manager inspecting stage evidence rather
 * than a rollup gate deciding who gets hired. `manager_review` is where that
 * person acts, and this module is the only place that says what acting means.
 *
 * Pure: no DB, no AI, no side effects. The action executes the transition; this
 * only decides which one is being asked for and whether it is allowed at all.
 */

/**
 * What a manager can conclude. Deliberately three outcomes, not a free choice
 * of target state — a decision is a human judgement with a name, and naming it
 * here is what lets the UI, the action, and the audit log agree on one
 * vocabulary instead of each mapping raw states independently.
 */
export const MANAGER_REVIEW_DECISIONS = ["advance", "hire", "reject"] as const;

export type ManagerReviewDecision = (typeof MANAGER_REVIEW_DECISIONS)[number];

/**
 * The state each decision lands on.
 *
 * `advance` is the mainline: manager review is not the last step — a human
 * final interview follows, and that is where candidate-facing slot booking
 * lives. `hire` exists because the graph allows skipping it, for a role where
 * the AI interview plus the manager's read is genuinely enough.
 *
 * A `Record` rather than a `switch` so adding a decision to the union without
 * routing it is a type error, not a runtime `undefined`.
 */
const DECISION_TARGETS: Record<ManagerReviewDecision, ApplicationState> = {
  advance: "final_interview_scheduling",
  hire: "hired",
  reject: "rejected",
};

export function managerDecisionTarget(
  decision: ManagerReviewDecision,
): ApplicationState {
  return DECISION_TARGETS[decision];
}

/**
 * Guard the decision point against a stale page.
 *
 * The recruiter's tab may have been open since before the application moved, so
 * a decision can arrive for something already hired, already rejected, or not
 * yet reviewed. Recording it anyway would write a manager's judgement against a
 * state that no longer exists — and because the transition log is the audit
 * trail, that judgement would then look like it was made on evidence it never
 * saw.
 *
 * The two failures read differently on purpose: arriving early means "start the
 * review first", arriving late means "someone already decided". Collapsing them
 * into one message would leave the recruiter guessing which happened.
 */
export function assertReviewable(currentState: ApplicationState): void {
  if (currentState === "manager_review") return;

  const decided: ApplicationState[] = [
    "hired",
    "rejected",
    "final_interview_scheduling",
    "archived",
  ];

  if (decided.includes(currentState)) {
    throw new Error(
      "This application is no longer in manager review — someone has already decided on it. Reload to see where it landed.",
    );
  }

  throw new Error(
    "This application is not yet in manager review. Move it there first, so the decision is recorded against the right stage.",
  );
}
