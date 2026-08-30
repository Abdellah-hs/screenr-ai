/**
 * An interview rubric dimension, reduced to what scoring is allowed to see.
 *
 * The stored `rubric_dimensions` row carries more than this — `is_mandatory`,
 * `min_score`, `importance`, `sort_order`. Only `weight` crosses into the
 * scorer, and the omissions are the design:
 *
 * - **`is_mandatory` / `min_score` are deliberately absent.** There is no
 *   must-have gate on the interview, and there is no interview threshold at all
 *   (CLAUDE.md, 2026-08-21/22): the stage never rejects, at any score, because
 *   rejecting someone who sat a whole interview on the strength of one number
 *   is the decision most worth keeping human. The Must-Have control was removed
 *   from this stage's editor for naming a rule that does not exist; leaving the
 *   fields out of the type is what stops it being reintroduced by accident.
 * - **`importance` is absent because `weight` already is it.** `weight` is
 *   derived from importance on save by `deriveDimensionFields`; reading both
 *   would be two sources for one decision.
 *
 * Named `InterviewRubricDimension` rather than `InterviewDimension` because the
 * data layer already owns the latter — that is a SCORED dimension on a stored
 * result, and this is the rubric row it was graded against.
 */
export interface InterviewRubricDimension {
  id: string;
  name: string;
  /** Normalised share of the overall score. A rubric's weights sum to ~1. */
  weight: number;
}

/**
 * What an interview is scored against when the campaign has no interview
 * rubric — created before the rubric mattered, or the tab was emptied.
 *
 * This is a degenerate rubric, NOT a second scorer. It runs through
 * `calculateInterviewScore` like any other, so rubric-less campaigns are graded
 * by exactly the same arithmetic; the alternative — keeping the old
 * model-scored path alive for this case — is a fallback nobody tests and
 * everybody eventually has to debug, and it would put two different kinds of
 * number in the same column.
 *
 * Screening solves the same problem by promoting each question to a dimension.
 * The interview has no stored questions to promote (the interviewer holds a
 * free-form conversation), so the stand-in has to be named here.
 *
 * These four are close to what the retired prompt asked the model to invent for
 * itself, which is the point: it is the same coverage, chosen once and applied
 * to every candidate, instead of re-chosen per interview. Equal weights, since
 * a recruiter who did not build a rubric has expressed no preference.
 *
 * The ids are stable slugs rather than UUIDs — nothing joins on them, they only
 * align evidence to dimensions — and are deliberately readable in a stored
 * score, so it is obvious after the fact that no rubric was used.
 */
export const DEFAULT_INTERVIEW_DIMENSIONS: InterviewRubricDimension[] = [
  { id: "default:technical_depth", name: "Technical depth", weight: 0.25 },
  { id: "default:problem_solving", name: "Problem solving", weight: 0.25 },
  { id: "default:communication", name: "Communication", weight: 0.25 },
  { id: "default:role_fit", name: "Role fit", weight: 0.25 },
];

/**
 * The rubric to grade against: the recruiter's if they have one, the default
 * set otherwise. One place, so every caller degrades identically.
 */
export function interviewScoringDimensions(
  rubricDimensions: InterviewRubricDimension[],
): InterviewRubricDimension[] {
  return rubricDimensions.length > 0 ? rubricDimensions : DEFAULT_INTERVIEW_DIMENSIONS;
}
