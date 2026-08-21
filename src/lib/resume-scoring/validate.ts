import type { ResumeCriterion } from "./criteria";
import type {
  EvidenceLevel,
  ResumeCriterionEvidence,
  ResumeEvidenceItem,
  ResumeEvidenceResponse,
} from "./evidence";

/**
 * The evidence came back in a shape no amount of conservatism can rescue —
 * a different number of criteria, or criteria in a different order. Both mean
 * we cannot tell which finding belongs to which requirement, so there is
 * nothing safe to salvage and the run is rejected outright.
 */
export class ResumeEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeEvidenceValidationError";
  }
}

export interface ValidatedCriterionEvidence {
  criterion_label: string;
  /** The level after validation — never higher than what survived verification. */
  evidence_level: EvidenceLevel;
  /** What the model claimed, kept so a downgrade is visible in the audit trail. */
  reported_evidence_level: EvidenceLevel;
  /** Only items whose quote was found in the resume text. */
  evidence_items: ResumeEvidenceItem[];
  extracted_relevant_months: number | null;
  notes: string | null;
}

export interface ValidatedResumeEvidence {
  criteria: ValidatedCriterionEvidence[];
  extraction_summary: string;
  /**
   * Soft findings: quotes that did not check out, levels that were downgraded,
   * evidence attached to a `not_present` verdict. Kept separate from the hard
   * errors above because they describe a result we still trust *after*
   * correcting it, and a recruiter reading the score deserves to see both the
   * correction and why it happened.
   */
  warnings: string[];
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const QUOTE_CHARS = /[\u2018\u2019\u201A\u201B\u2032]/g;
const DOUBLE_QUOTE_CHARS = /[\u201C\u201D\u201E\u201F\u2033]/g;
const DASH_CHARS = /[\u2010-\u2015\u2212]/g;

/**
 * Fold away every difference that is not a difference in what was said:
 * Unicode composition, case, curly-vs-straight punctuation, and whitespace
 * (including the line breaks our own document builder inserts).
 *
 * Deliberately conservative about what it does NOT remove — words, digits and
 * ordinary punctuation all survive, so this can widen a match but never invent
 * one between two genuinely different sentences.
 */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(QUOTE_CHARS, "'")
    .replace(DOUBLE_QUOTE_CHARS, '"')
    .replace(DASH_CHARS, "-")
    .replace(/\u2026/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `quote` appears in `sourceText`, ignoring only cosmetic differences. */
export function normalizedIncludes(sourceText: string, quote: string): boolean {
  const needle = normalizeForQuoteMatch(quote);
  if (!needle) return false;
  return normalizeForQuoteMatch(sourceText).includes(needle);
}

/**
 * The level an unconfirmed claim collapses to.
 *
 * `unclear` rather than `not_present` because the two say different things and
 * only one of them is honest here: `not_present` asserts the resume contains no
 * such evidence, which we have not established — we established that the
 * *quote* could not be found. Both score 0, so the candidate is treated
 * identically either way; the difference is only in what the record claims.
 */
const UNVERIFIED_LEVEL: EvidenceLevel = "unclear";

function validateOne(
  reported: ResumeCriterionEvidence,
  normalizedResumeText: string,
  warnings: string[],
): ValidatedCriterionEvidence {
  const label = reported.criterion_label;

  if (reported.evidence_level === "not_present") {
    // A "found nothing" verdict that ships quotes is self-contradictory. The
    // verdict is the conservative half, so it wins and the items go.
    if (reported.evidence_items.length > 0) {
      warnings.push(
        `${label}: evidence level "not_present" was returned with ${reported.evidence_items.length} evidence item(s); the items were discarded.`,
      );
    }
    return {
      criterion_label: label,
      evidence_level: "not_present",
      reported_evidence_level: "not_present",
      evidence_items: [],
      extracted_relevant_months: reported.extracted_relevant_months,
      notes: reported.notes,
    };
  }

  const verified: ResumeEvidenceItem[] = [];
  for (const item of reported.evidence_items) {
    if (normalizedIncludes(normalizedResumeText, item.quote)) {
      verified.push(item);
    } else {
      warnings.push(
        `${label}: a quote could not be found in the resume text and was discarded — "${item.quote.trim()}".`,
      );
    }
  }

  if (verified.length === 0) {
    warnings.push(
      reported.evidence_items.length === 0
        ? `${label}: evidence level "${reported.evidence_level}" was returned with no supporting quote; downgraded to "${UNVERIFIED_LEVEL}".`
        : `${label}: no quote for "${reported.evidence_level}" could be verified; downgraded to "${UNVERIFIED_LEVEL}".`,
    );
    return {
      criterion_label: label,
      evidence_level: UNVERIFIED_LEVEL,
      reported_evidence_level: reported.evidence_level,
      evidence_items: [],
      extracted_relevant_months: reported.extracted_relevant_months,
      notes: reported.notes,
    };
  }

  // Some quotes verified: the level stands, but it now rests only on what was
  // checked. The discarded ones are already warned about above, so a reviewer
  // can see that this criterion was partly unsupported without the candidate
  // losing credit that verified evidence does support.
  return {
    criterion_label: label,
    evidence_level: reported.evidence_level,
    reported_evidence_level: reported.evidence_level,
    evidence_items: verified,
    extracted_relevant_months: reported.extracted_relevant_months,
    notes: reported.notes,
  };
}

/**
 * Check extracted evidence against the criteria it was asked about and the
 * document it claims to quote, then hand back a corrected, trustworthy version.
 *
 * Pure. Two failure modes, kept apart on purpose:
 *   - structural (count / order) → throws, because nothing can be aligned;
 *   - evidential (missing or unverifiable quotes) → downgraded to a level that
 *     scores 0, with a warning, because a candidate should never gain from a
 *     quote nobody could find, and should never lose a run over it either.
 */
export function validateResumeEvidence(
  evidence: ResumeEvidenceResponse,
  criteria: ResumeCriterion[],
  normalizedResumeText: string,
): ValidatedResumeEvidence {
  if (evidence.criteria.length !== criteria.length) {
    throw new ResumeEvidenceValidationError(
      `Evidence extraction returned ${evidence.criteria.length} criteria but ${criteria.length} were requested.`,
    );
  }

  for (let i = 0; i < criteria.length; i++) {
    const expected = criteria[i].label.trim();
    const actual = evidence.criteria[i].criterion_label.trim();
    if (expected !== actual) {
      throw new ResumeEvidenceValidationError(
        `Evidence extraction returned criteria out of order: position ${i + 1} is "${actual}" but "${expected}" was requested.`,
      );
    }
  }

  const warnings: string[] = [];
  const validated = evidence.criteria.map((reported) =>
    validateOne(reported, normalizedResumeText, warnings),
  );

  return {
    criteria: validated,
    extraction_summary: evidence.extraction_summary,
    warnings,
  };
}
