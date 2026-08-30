import {
  APPLICATION_STATE_TRANSITIONS,
  type ApplicationState,
} from "@/lib/constants";

/**
 * Which candidates in a selection a bulk action may actually touch (PRD 3.12.1).
 *
 * A bulk advance is N individual transitions, each legal or not on its own
 * terms — never one `UPDATE`. This module decides, per application, what would
 * happen and why; the action performs the transitions one at a time. Keeping
 * the decision pure is what makes "show the recruiter exactly who will be
 * skipped, before they commit" possible at all.
 *
 * Nothing here transitions anything or touches a database.
 */

export const BULK_ACTIONS = ["advance", "reject", "talent_pool"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkCandidate {
  applicationId: string;
  name: string;
  currentState: ApplicationState;
}

export interface BulkPlanEntry {
  applicationId: string;
  name: string;
  currentState: ApplicationState;
  /** Where this application is headed. Null for a pool add and for skips. */
  toState: ApplicationState | null;
  /** Why it will not be touched. Null when it will be. */
  skipReason: string | null;
}

export interface BulkPlan {
  eligible: BulkPlanEntry[];
  skipped: BulkPlanEntry[];
}

/**
 * The one forward step a bulk advance takes from each state.
 *
 * Explicit rather than "the first non-rejecting legal edge", because several
 * states have more than one forward option and picking by position would make
 * the meaning of "advance" depend on the order someone happened to write the
 * transition map in.
 *
 * Two deliberate omissions:
 *
 * - **`manager_review` is not here.** Bulk moves people *up to* the decision
 *   points, never *through* them. The manager's call carries a mandatory
 *   rationale precisely because it is the last human judgement before an offer
 *   or a rejection, and one rationale spread across fifty candidates is not
 *   fifty judgements. Advancing INTO `manager_review` is fine and included —
 *   that is queuing work for a person, which is what bulk is for.
 * - **`screening_approved` is not here.** Its only forward edge is
 *   `screening_sent`, a system-produced state: the Send button reaches it by
 *   actually sending the email. Setting it in bulk would fabricate a sent
 *   email for people who never received one.
 */
const BULK_ADVANCE_TARGET: Partial<Record<ApplicationState, ApplicationState>> = {
  new: "screening_approved",
  screening_review_pending: "screening_approved",
  screening_scored: "interview_invited",
  interview_scored: "manager_review",
};

/** The forward target for a bulk advance, or null when there isn't one. */
export function bulkAdvanceTarget(
  currentState: ApplicationState,
): ApplicationState | null {
  const target = BULK_ADVANCE_TARGET[currentState];
  if (!target) return null;

  // The map is hand-written; the graph is the authority. A target the state
  // machine would reject must never reach `transition()` as a "planned" move.
  const legal = APPLICATION_STATE_TRANSITIONS[currentState] ?? [];
  return legal.includes(target) ? target : null;
}

/**
 * States a bulk action treats as closed. Not derived from the graph, and that
 * is the point: #144 opened `archived → rejected` so that un-archiving can
 * restore an application to the state it actually came from. That edge exists
 * for `unarchiveApplication`, which reads the transitions log to pick the right
 * target. A bulk reject riding the same edge would file an archived person as a
 * fresh rejection, which is not what happened to them.
 */
const CLOSED_STATES: readonly ApplicationState[] = ["hired", "rejected", "archived"];

/** Whether an application can be closed from where it currently sits. */
export function canBulkReject(currentState: ApplicationState): boolean {
  if (CLOSED_STATES.includes(currentState)) return false;

  return (APPLICATION_STATE_TRANSITIONS[currentState] ?? []).includes("rejected");
}

/**
 * Why this candidate is being left out, in the recruiter's terms.
 *
 * Written per case rather than as one generic "not eligible" because the whole
 * point of reporting skips is that the recruiter can tell whether the system
 * protected them from a mistake or is simply in their way.
 */
function advanceSkipReason(currentState: ApplicationState): string {
  if (currentState === "manager_review") {
    return "Waiting on a manager's decision — advance this one from their profile, with your reasoning.";
  }
  if (currentState === "screening_approved") {
    return "Ready for screening questions — use Send so the email actually goes out.";
  }
  if (CLOSED_STATES.includes(currentState)) {
    return "Already closed.";
  }
  if (currentState === "screening_sent" || currentState === "interview_invited") {
    return "Waiting on the candidate.";
  }
  return "No bulk advance available from this stage.";
}

export function planBulkAction(
  candidates: BulkCandidate[],
  action: BulkAction,
): BulkPlan {
  const eligible: BulkPlanEntry[] = [];
  const skipped: BulkPlanEntry[] = [];

  for (const candidate of candidates) {
    const base = {
      applicationId: candidate.applicationId,
      name: candidate.name,
      currentState: candidate.currentState,
    };

    if (action === "talent_pool") {
      // A pool entry is a bookmark, not pipeline state — every stage qualifies,
      // including the closed ones, which is where silver medalists come from.
      eligible.push({ ...base, toState: null, skipReason: null });
      continue;
    }

    if (action === "reject") {
      if (canBulkReject(candidate.currentState)) {
        eligible.push({ ...base, toState: "rejected", skipReason: null });
      } else {
        skipped.push({
          ...base,
          toState: null,
          skipReason: "Already closed.",
        });
      }
      continue;
    }

    const target = bulkAdvanceTarget(candidate.currentState);
    if (target) {
      eligible.push({ ...base, toState: target, skipReason: null });
    } else {
      skipped.push({
        ...base,
        toState: null,
        skipReason: advanceSkipReason(candidate.currentState),
      });
    }
  }

  return { eligible, skipped };
}

/** One application's result after the action ran. */
export interface BulkOutcome {
  applicationId: string;
  name: string;
  status: "succeeded" | "skipped" | "failed";
  /** Skip reason or error message; null on success. */
  detail: string | null;
  toState: ApplicationState | null;
}

export interface BulkResult {
  action: BulkAction;
  succeeded: number;
  skipped: number;
  failed: number;
  outcomes: BulkOutcome[];
}

/**
 * Roll per-application outcomes into the summary the UI reports.
 *
 * Counts are derived from the outcomes rather than tracked alongside them, so
 * the headline number and the list underneath it cannot disagree — which is
 * the failure mode that would make "nothing fails silently" untrue in the one
 * place a recruiter would actually notice.
 */
export function summarizeBulkResult(
  action: BulkAction,
  outcomes: BulkOutcome[],
): BulkResult {
  return {
    action,
    succeeded: outcomes.filter((o) => o.status === "succeeded").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}
