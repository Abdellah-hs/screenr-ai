import { normalizedIncludes } from "@/lib/resume-scoring/validate";
import type { EvidenceLevel } from "@/lib/scoring/evidence-levels";
import {
  UNANSWERED_LEVEL,
  type ScreeningAnswerEvidence,
  type ScreeningEvidenceItem,
  type ScreeningEvidenceResponse,
} from "./evidence";

/**
 * The evidence came back in a shape no amount of conservatism can rescue — a
 * different number of answers, or answers for questions that were not asked.
 * Both mean we cannot tell which finding belongs to which question, so there is
 * nothing safe to salvage and the run is rejected outright.
 */
export class ScreeningEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningEvidenceValidationError";
  }
}

export interface ValidatedAnswerEvidence {
  question_id: string;
  /** The level after validation — never higher than what survived verification. */
  evidence_level: EvidenceLevel;
  /** What the model claimed, kept so a downgrade is visible in the audit trail. */
  reported_evidence_level: EvidenceLevel;
  /** Only items whose quote was found in the candidate's own speech. */
  evidence_items: ScreeningEvidenceItem[];
  notes: string | null;
}

export interface ValidatedScreeningEvidence {
  answers: ValidatedAnswerEvidence[];
  extraction_summary: string;
  /**
   * Soft findings: quotes that did not check out, levels that were downgraded,
   * evidence attached to a "never answered" verdict. Kept separate from the
   * hard errors above because they describe a result we still trust *after*
   * correcting it, and a recruiter reading the score deserves to see both the
   * correction and why it happened.
   */
  warnings: string[];
}

/**
 * The level an unconfirmed claim collapses to.
 *
 * `unclear` rather than `not_present` because the two say different things and
 * only one of them is honest here: `not_present` asserts the candidate never
 * addressed the question, which we have not established — we established that
 * the *quote* could not be found in their speech. Both score 0, so the
 * candidate is treated identically either way; the difference is only in what
 * the record claims about them.
 */
const UNVERIFIED_LEVEL: EvidenceLevel = "unclear";

/**
 * Check the model's evidence against the transcript and correct it downwards
 * where it does not hold up.
 *
 * Two kinds of failure, handled differently on purpose:
 *
 * - **Structural** (wrong answer count, unknown or duplicated question id) —
 *   the mapping between findings and questions is broken, so nothing can be
 *   trusted and the run is thrown away.
 * - **Evidential** (a quote that is not in the candidate's speech) — the
 *   mapping is intact and only this claim failed, so the claim is dropped and
 *   the level is downgraded, with a warning recorded.
 *
 * Nothing here can ever raise a level. A model that wants a higher score has to
 * find words the candidate actually said.
 */
export function validateScreeningEvidence(params: {
  response: ScreeningEvidenceResponse;
  questionIds: string[];
  /** The candidate's own words — see `buildCandidateSpeech`. */
  candidateSpeech: string;
  /** Questions code has already determined were never reached, if any. */
  unansweredQuestionIds?: Set<string>;
}): ValidatedScreeningEvidence {
  const { response, questionIds, candidateSpeech } = params;
  const unanswered = params.unansweredQuestionIds ?? new Set<string>();
  const warnings: string[] = [];

  if (response.answers.length !== questionIds.length) {
    throw new ScreeningEvidenceValidationError(
      `Expected evidence for ${questionIds.length} question(s) but received ${response.answers.length}.`,
    );
  }

  const byId = new Map<string, ScreeningAnswerEvidence>();
  for (const answer of response.answers) {
    if (byId.has(answer.question_id)) {
      throw new ScreeningEvidenceValidationError(
        `Evidence for question ${answer.question_id} was returned more than once.`,
      );
    }
    byId.set(answer.question_id, answer);
  }

  const answers = questionIds.map((questionId) => {
    const reported = byId.get(questionId);
    if (!reported) {
      throw new ScreeningEvidenceValidationError(
        `No evidence was returned for question ${questionId}.`,
      );
    }
    return validateOne(reported, candidateSpeech, unanswered, warnings);
  });

  return { answers, extraction_summary: response.extraction_summary, warnings };
}

function validateOne(
  reported: ScreeningAnswerEvidence,
  candidateSpeech: string,
  unanswered: Set<string>,
  warnings: string[],
): ValidatedAnswerEvidence {
  const id = reported.question_id;

  // Code already read the transcript and found nothing for this question. That
  // finding outranks the model's, which is why it is checked first: a model
  // that invents an answer for a question the call never reached must not be
  // able to talk its way past the transcript.
  if (unanswered.has(id)) {
    if (reported.evidence_level !== UNANSWERED_LEVEL) {
      warnings.push(
        `${id}: the model reported "${reported.evidence_level}" for a question the candidate never reached; forced to "${UNANSWERED_LEVEL}".`,
      );
    }
    return {
      question_id: id,
      evidence_level: UNANSWERED_LEVEL,
      reported_evidence_level: reported.evidence_level,
      evidence_items: [],
      notes: reported.notes,
    };
  }

  if (reported.evidence_level === "not_present") {
    // A "never answered" verdict that ships quotes is self-contradictory. The
    // verdict is the conservative half, so it wins and the items go.
    if (reported.evidence_items.length > 0) {
      warnings.push(
        `${id}: evidence level "not_present" was returned with ${reported.evidence_items.length} evidence item(s); the items were discarded.`,
      );
    }
    return {
      question_id: id,
      evidence_level: "not_present",
      reported_evidence_level: "not_present",
      evidence_items: [],
      notes: reported.notes,
    };
  }

  const verified: ScreeningEvidenceItem[] = [];
  for (const item of reported.evidence_items) {
    if (normalizedIncludes(candidateSpeech, item.quote)) {
      verified.push(item);
    } else {
      warnings.push(
        `${id}: a quote could not be found in the candidate's speech and was discarded — "${item.quote.trim()}".`,
      );
    }
  }

  if (verified.length === 0) {
    warnings.push(
      reported.evidence_items.length === 0
        ? `${id}: evidence level "${reported.evidence_level}" was returned with no supporting quote; downgraded to "${UNVERIFIED_LEVEL}".`
        : `${id}: no quote for "${reported.evidence_level}" could be verified; downgraded to "${UNVERIFIED_LEVEL}".`,
    );
    return {
      question_id: id,
      evidence_level: UNVERIFIED_LEVEL,
      reported_evidence_level: reported.evidence_level,
      evidence_items: [],
      notes: reported.notes,
    };
  }

  return {
    question_id: id,
    evidence_level: reported.evidence_level,
    reported_evidence_level: reported.evidence_level,
    evidence_items: verified,
    notes: reported.notes,
  };
}
