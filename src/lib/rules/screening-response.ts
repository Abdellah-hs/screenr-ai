export type ScreeningResponseStatus =
  | "pending"
  | "sent"
  | "responded"
  | "scored"
  | "expired";

/**
 * Thrown by rules in this module when a candidate-facing precondition
 * fails. The `message` is the string the candidate sees, so it must
 * remain stable — public tests pin it verbatim.
 */
export class ScreeningResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningResponseError";
  }
}

/**
 * Guard for the form-load path: a candidate can only open their form
 * if the response row is still accepting input.
 *   - `scored`  → already processed by the recruiter; nothing to do.
 *   - `expired` → deadline passed; a recruiter has to issue a new link.
 */
export function assertResponseIsOpen(status: ScreeningResponseStatus): void {
  if (status === "scored") {
    throw new ScreeningResponseError(
      "Your answers have already been submitted and reviewed. Thank you!",
    );
  }
  if (status === "expired") {
    throw new ScreeningResponseError(
      "This link has expired. Please contact the hiring team for a new one.",
    );
  }
}

/**
 * Guard for the submit path: prevents a candidate from re-submitting
 * after their answers have been scored. (Other statuses — pending,
 * sent, responded — are all valid entry points for a submission; the
 * caller is responsible for persisting idempotently.)
 */
export function assertResponseNotResubmitted(status: ScreeningResponseStatus): void {
  if (status === "scored") {
    throw new ScreeningResponseError(
      "Your answers have already been submitted. You cannot re-submit.",
    );
  }
}

interface QuestionWithRequiredFlag {
  id: string;
  is_required: boolean;
}

interface AnswerRef {
  question_id: string;
}

/**
 * Ensures every required question has a corresponding answer in the
 * submission. Non-empty-string validation is Zod's responsibility
 * upstream; this rule only cares about presence.
 */
export function validateRequiredAnswersPresent(
  questions: QuestionWithRequiredFlag[],
  answers: AnswerRef[],
): void {
  const answered = new Set(answers.map((a) => a.question_id));
  const missingRequired = questions.filter(
    (q) => q.is_required && !answered.has(q.id),
  );
  if (missingRequired.length > 0) {
    throw new ScreeningResponseError(
      `Please answer every required question before submitting (${missingRequired.length} missing).`,
    );
  }
}
