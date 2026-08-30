import type { ApplicationState } from "@/lib/constants";

/**
 * Why there is no score, said as a named lifecycle state.
 *
 * A dash in a score column is ambiguous between at least four different facts —
 * nothing has run yet, the candidate never showed up, the link died unused, the
 * CV could not be read — and each has a different next action. Collapsing them
 * into "—" makes the column unreadable exactly where it matters most, because
 * the rows with no number are the rows that need a person.
 *
 * A `Record` over every state, so adding one to the state machine without
 * deciding what its empty score cell says is a type error rather than a dash.
 */
const ABSENCE: Record<ApplicationState, string> = {
  new: "Not scored yet",
  screening_review_pending: "Awaiting your approval",
  screening_approved: "Link going out",
  screening_sent: "Awaiting the call",
  screening_completed: "Scoring the call",
  screening_scored: "Not scored yet",

  interview_invited: "Awaiting the interview",
  interview_scheduling: "Not scored yet",
  interview_scheduled: "Not scored yet",
  interview_completed: "Scoring the interview",
  interview_scored: "Not scored yet",

  manager_review: "No stage score here",
  final_interview_scheduling: "Awaiting booking",

  hired: "Hired",
  rejected: "Rejected",
  archived: "Archived",

  screening_expired: "Screening expired",
  interview_expired: "Interview expired",
  interview_no_show: "No show",
  processing_failed: "Processing failed",
};

export function scoreAbsenceLabel(status: ApplicationState): string {
  return ABSENCE[status] ?? "Not scored yet";
}

/**
 * Absences that are a lapse rather than a stage still in flight.
 *
 * These are the ones where nobody decided anything and the pipeline stopped
 * anyway, so a list can mark them without implying the candidate was rejected.
 */
const LAPSED = new Set<ApplicationState>([
  "screening_expired",
  "interview_expired",
  "interview_no_show",
  "processing_failed",
]);

export function isLapsedAbsence(status: ApplicationState): boolean {
  return LAPSED.has(status);
}
