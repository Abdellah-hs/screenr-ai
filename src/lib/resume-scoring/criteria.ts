import { z } from "zod/v4";
import type { DimensionImportance } from "@/lib/constants";
import { deriveDimensionFields } from "@/lib/rubric-weights";

/**
 * The ONLY decision a recruiter makes about a resume-screening criterion.
 *
 * Must-haves are eligibility gates. Nice-to-haves are ranking signals. That
 * distinction is categorical, not a point on a scale, which is why there is no
 * numeric weight here for the recruiter to set — a weight would imply that
 * enough of one thing can buy its way past another, and for a must-have it
 * never can.
 */
export const CriterionPrioritySchema = z.enum(["must_have", "nice_to_have"]);

export type CriterionPriority = z.infer<typeof CriterionPrioritySchema>;

export interface ResumeCriterion {
  id: string;
  label: string;
  priority: CriterionPriority;
}

/**
 * The evidence score every must-have has to reach. One fixed line for all of
 * them, deliberately: a per-criterion line is another dial that lets a
 * recruiter quietly soften a gate, and the evidence levels are already the
 * vocabulary for "how much proof is enough" (see EVIDENCE_LEVEL_SCORE).
 *
 * At 60, `partial` (55) fails and `strong` (80) passes — a must-have needs
 * concrete professional or project evidence, not a mention and not one course.
 */
export const MUST_HAVE_MINIMUM_SCORE = 60;

/**
 * Bridge from the stored rubric dimension (which predates the priority model
 * and carries `is_mandatory`) to the recruiter-facing priority. Must-Have was
 * always the same decision under a different name.
 */
export function priorityFromMandatoryFlag(isMandatory: boolean): CriterionPriority {
  return isMandatory ? "must_have" : "nice_to_have";
}

export function mandatoryFlagFromPriority(priority: CriterionPriority): boolean {
  return priority === "must_have";
}

/**
 * Importance is not a recruiter input on the resume stage any more, but the
 * column is NOT NULL and the other two stages still use it. Deriving it from
 * priority keeps the row coherent (and the derived `weight` sensible for any
 * legacy reader) without asking the recruiter a question whose answer the
 * resume gate would then ignore.
 */
export function importanceFromPriority(priority: CriterionPriority): DimensionImportance {
  return priority === "must_have" ? "high" : "medium";
}

export interface ResumeDimensionIntent {
  priority: CriterionPriority;
}

export interface DerivedResumeDimensionFields {
  importance: DimensionImportance;
  weight: number;
  is_mandatory: boolean;
  min_score: number;
  max_score: number;
}

/**
 * Turn resume-stage recruiter intent (priority, and nothing else) into the
 * numeric columns `rubric_dimensions` stores.
 *
 * `min_score` is pinned to `MUST_HAVE_MINIMUM_SCORE` rather than the generic
 * `MANDATORY_FAIL_LINE` the other stages use, so the stored row states the same
 * gate the deterministic scorer actually applies. `weight` is written for
 * backward compatibility only — nothing in the resume flow reads it, and
 * nothing may: a weight that could move eligibility is exactly the compensation
 * this model exists to forbid.
 */
export function deriveResumeDimensionFields<T extends ResumeDimensionIntent>(
  dimensions: T[],
): (T & DerivedResumeDimensionFields)[] {
  const withIntent = dimensions.map((d) => ({
    ...d,
    importance: importanceFromPriority(d.priority),
    is_mandatory: mandatoryFlagFromPriority(d.priority),
  }));

  return deriveDimensionFields(withIntent).map((d) => ({
    ...d,
    min_score: d.is_mandatory ? MUST_HAVE_MINIMUM_SCORE : 0,
  }));
}
