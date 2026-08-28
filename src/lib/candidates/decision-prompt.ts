import type { ApplicationState } from "@/lib/constants";

export interface DecisionPrompt {
  /** Where the application stands, in one clause. */
  headline: string;
  /** Who it is waiting on, and what happens if nobody acts. */
  detail: string;
  /** True when the next move is the recruiter's. Drives the rail's emphasis. */
  waitingOnYou: boolean;
}

/**
 * What the decision rail says above the buttons.
 *
 * Every line answers the same two questions: what has happened, and who it is
 * waiting on. This is the ATS's central claim made visible — the AI scores and
 * stops, and an application only moves when a rule fires or a person decides —
 * so a state where nothing is owed says so plainly rather than leaving a row of
 * buttons implying there is something to do.
 *
 * A `Record` over every state, so adding one to the state machine without
 * deciding what it means for the person reading the file is a type error.
 */
const PROMPTS: Record<ApplicationState, DecisionPrompt> = {
  new: {
    headline: "The CV has arrived",
    detail: "Nothing has been read or scored yet. No decision is owed.",
    waitingOnYou: false,
  },
  screening_review_pending: {
    headline: "The CV is scored and waiting on you",
    detail:
      "This campaign approves every CV by hand. Approving sends the screening link; nothing goes out until you do.",
    waitingOnYou: true,
  },
  screening_approved: {
    headline: "Approved into screening",
    detail: "The screening link goes out next. Nothing is owed by you.",
    waitingOnYou: false,
  },
  screening_sent: {
    headline: "The screening link is with the candidate",
    detail:
      "It expires on its own if they never take it, and you will see it here as lapsed.",
    waitingOnYou: false,
  },
  screening_completed: {
    headline: "The screening call is in",
    detail: "Scoring runs next. Nothing is owed by you.",
    waitingOnYou: false,
  },
  screening_scored: {
    headline: "Screening is done",
    detail: "Nothing moves until you choose.",
    waitingOnYou: true,
  },
  interview_invited: {
    headline: "The interview invite is out",
    detail:
      "The candidate takes it whenever they are ready, inside the deadline. Nothing is owed by you until then.",
    waitingOnYou: false,
  },
  interview_scheduling: {
    headline: "Interview scheduling",
    detail: "A deprecated state. Move it on by hand.",
    waitingOnYou: true,
  },
  interview_scheduled: {
    headline: "Interview scheduled",
    detail: "A deprecated state. Move it on by hand.",
    waitingOnYou: true,
  },
  interview_completed: {
    headline: "The interview is in",
    detail: "Scoring runs next. Nothing is owed by you.",
    waitingOnYou: false,
  },
  interview_scored: {
    headline: "The interview is scored",
    detail:
      "The score gates nothing and rejected nobody. Nothing moves until you choose.",
    waitingOnYou: true,
  },
  reference_check: {
    headline: "References are being checked",
    detail: "Move it on once they are back.",
    waitingOnYou: true,
  },
  manager_review: {
    headline: "This is the decision point",
    detail:
      "Everything the AI can produce has been produced. Hire, reject, or send it to a final round.",
    waitingOnYou: true,
  },
  final_interview_scheduling: {
    headline: "Waiting on the candidate to book the final round",
    detail: "They pick a slot from your calendar. Nothing is owed by you until they do.",
    waitingOnYou: false,
  },
  hired: {
    headline: "Hired",
    detail: "This application is closed. The record below is kept as it was.",
    waitingOnYou: false,
  },
  rejected: {
    headline: "Rejected",
    detail: "This application is closed. The reason is on the history below.",
    waitingOnYou: false,
  },
  archived: {
    headline: "Archived",
    detail: "Out of the pipeline, kept in the record.",
    waitingOnYou: false,
  },
  screening_expired: {
    headline: "The screening link lapsed",
    detail:
      "Nobody rejected this candidate — they never took the call. Re-invite them or close it out.",
    waitingOnYou: true,
  },
  interview_expired: {
    headline: "The interview window closed",
    detail:
      "Nobody rejected this candidate — the deadline passed. Re-invite them or close it out.",
    waitingOnYou: true,
  },
  interview_no_show: {
    headline: "The candidate did not attend",
    detail: "Nobody rejected them. This needs a call, not a click.",
    waitingOnYou: true,
  },
  processing_failed: {
    // Not "the CV could not be read": this state is reached when OUR side
    // failed — an extractor timeout, a model outage, a score that would not
    // compute. The candidate's file is usually fine and often has not been
    // opened at all.
    headline: "Processing failed on our side",
    detail: "Not scored and not rejected. Open the candidate to try again.",
    waitingOnYou: true,
  },
};

export function decisionPrompt(status: ApplicationState): DecisionPrompt {
  return PROMPTS[status];
}
