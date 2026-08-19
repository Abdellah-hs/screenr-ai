import type {
  ApplicationState,
  DispositionCode,
  TransitionActor,
} from "@/lib/constants";

/**
 * Turns the raw `application_transitions` log into the per-candidate activity
 * timeline (PRD 3.6.3) with override history attached (PRD 3.7.2).
 *
 * Pure. The log is already complete and already trustworthy — this decides what
 * it *means*: how long the application sat in each state, and which human
 * actions reversed an automated decision.
 */

/** One row of the append-only log, as the data layer hands it over. */
export interface TransitionRow {
  id: string;
  from_state: ApplicationState | null;
  to_state: ApplicationState;
  actor: TransitionActor;
  rationale: string | null;
  disposition_code: DispositionCode | null;
  disposition_description: string | null;
  created_at: string;
}

/**
 * Which way a transition moves the application.
 *
 * Needed because "override" is not a property of a single row — it is a
 * disagreement between two. Without a direction there is nothing to disagree
 * about: every recruiter action following an automated one would look like a
 * reversal, including a recruiter simply carrying on where the pipeline
 * stopped, which is the normal case and not an override at all.
 */
export type TransitionPolarity = "advance" | "reject" | "neutral";

/*
 * Only one direction of override is reachable today, and it is worth being
 * explicit about why the check is written both ways anyway.
 *
 * `APPLICATION_STATE_TRANSITIONS` makes `rejected` a dead end (`["archived"]`),
 * so an automated rejection cannot be reversed by anyone — the override that
 * actually happens is the opposite: the pipeline advanced on a score and a
 * human rejected. Every advancing state has `rejected` as a legal exit, which
 * is exactly the manager's `OVERRIDE_REJECTED` path.
 *
 * The comparison stays symmetric because it costs nothing and stays correct if
 * the graph ever opens up — encoding "reject then advance is impossible" here
 * would put a copy of the state machine in a module that has no business
 * holding one.
 */

const REJECTING_STATES: ApplicationState[] = [
  "rejected",
  "archived",
  "screening_expired",
  "interview_expired",
  "interview_no_show",
  "processing_failed",
];

const ADVANCING_STATES: ApplicationState[] = [
  "screening_approved",
  "screening_sent",
  "interview_invited",
  "manager_review",
  "reference_check",
  "final_interview_scheduling",
  "hired",
];

export function transitionPolarity(state: ApplicationState): TransitionPolarity {
  if (REJECTING_STATES.includes(state)) return "reject";
  if (ADVANCING_STATES.includes(state)) return "advance";
  // Everything else records that something happened — a score landed, a
  // candidate responded, a review was requested — without taking a side.
  // `screening_review_pending` is deliberately here: the pipeline asking a
  // human to decide is not itself a decision, so the answer cannot override it.
  return "neutral";
}

/**
 * Whether a transition was made by the machine rather than a person.
 *
 * `system` and `ai` are both automated, and the distinction between them is not
 * one the log actually draws: nothing in the codebase writes `actor: "ai"`,
 * because CLAUDE.md's rule is that AI produces evidence and a *rule* performs
 * the transition — so an AI-driven decision is recorded as `system`. Matching
 * on `ai` alone would build an override detector that never fires.
 */
function isAutomated(actor: TransitionActor): boolean {
  return actor === "system" || actor === "ai";
}

/** The automated decision a recruiter action reversed. */
export interface OverriddenDecision {
  toState: ApplicationState;
  rationale: string | null;
  at: string;
}

export interface TimelineEntry {
  id: string;
  fromState: ApplicationState | null;
  toState: ApplicationState;
  actor: TransitionActor;
  rationale: string | null;
  disposition: { code: DispositionCode; description: string | null } | null;
  at: string;
  /**
   * Hours the application spent in `fromState` before this transition fired —
   * the same number SLA breaches are computed from, which is what makes an
   * overdue badge explicable rather than mysterious. Null on the first entry,
   * which has nothing before it to measure against.
   */
  hoursInPreviousState: number | null;
  /**
   * Set when this recruiter action reversed an automated decision (PRD 3.7.2),
   * carrying that decision so both sides read together.
   */
  overrides: OverriddenDecision | null;
}

export interface ActivityTimeline {
  entries: TimelineEntry[];
  /**
   * Hours the application has been sitting in its current state. Null for an
   * empty log — an application with no transitions has no observed dwell time,
   * which is different from having sat for zero hours.
   */
  hoursInCurrentState: number | null;
}

function hoursBetween(earlier: string, later: string): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 3_600_000;
}

/**
 * The automated decision this recruiter action contradicts, or null.
 *
 * Walks backwards to the nearest automated transition that actually took a
 * side. Neutral rows in between — a score landing, a candidate responding — are
 * skipped rather than treated as the decision, because they are not decisions.
 */
function findOverridden(
  rows: TransitionRow[],
  index: number,
): OverriddenDecision | null {
  const row = rows[index];
  if (row.actor !== "recruiter") return null;

  const polarity = transitionPolarity(row.to_state);

  for (let i = index - 1; i >= 0; i -= 1) {
    const prior = rows[i];
    if (!isAutomated(prior.actor)) continue;

    const priorPolarity = transitionPolarity(prior.to_state);
    if (priorPolarity === "neutral") continue;

    // The nearest automated *decision*. Opposite sides means an override; the
    // same side means the recruiter agreed and carried on, which is not one.
    if (priorPolarity === polarity || polarity === "neutral") return null;

    return {
      toState: prior.to_state,
      rationale: prior.rationale,
      at: prior.created_at,
    };
  }

  return null;
}

export function buildActivityTimeline(
  rows: TransitionRow[],
  now: Date = new Date(),
): ActivityTimeline {
  if (rows.length === 0) return { entries: [], hoursInCurrentState: null };

  // The log is append-only and the data layer orders it oldest-first; sorting
  // here as well means a timeline cannot be silently reordered by a query
  // change, and override detection depends on the order being right.
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const entries = ordered.map((row, index) => {
    const overrides = findOverridden(ordered, index);

    return {
      id: row.id,
      fromState: row.from_state,
      toState: row.to_state,
      actor: row.actor,
      rationale: row.rationale,
      disposition: row.disposition_code
        ? { code: row.disposition_code, description: row.disposition_description }
        : null,
      at: row.created_at,
      hoursInPreviousState:
        index === 0 ? null : hoursBetween(ordered[index - 1].created_at, row.created_at),
      // A manager who ticked "I'm overriding a passing result" said so
      // explicitly; trust that over the inference, which cannot see a decision
      // that predates the log or was never written as a transition.
      overrides:
        overrides ??
        (row.disposition_code === "OVERRIDE_REJECTED" && row.from_state
          ? { toState: row.from_state, rationale: null, at: row.created_at }
          : null),
    };
  });

  const last = ordered[ordered.length - 1];

  return {
    entries,
    hoursInCurrentState: hoursBetween(last.created_at, now.toISOString()),
  };
}
