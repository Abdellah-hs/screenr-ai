/**
 * What actually happened to one screening question, for the recruiter's
 * "Questions asked" list.
 *
 * This exists because that list used to lie. It decided a question had been
 * answered from `answers[].answer_text` and `answers[].score` — the shape of
 * the retired typed-answer form — and neither is ever written on a modern voice
 * call. The row is created at send time with `answer_text: ""` and
 * `score: null`, and since the rubric became the scoring unit (2026-08-22) the
 * voice path returns `answers: null`, so nothing ever fills them in. Every
 * question on every rubric-era call therefore read **"Never answered."**,
 * including on a call where the candidate answered all of them — a false
 * statement about a person, in the one place a recruiter goes to check.
 *
 * The topic ledger is the record that actually knows. It is stamped during the
 * call, keyed on `screening_questions.id`, and is authoritative on coverage:
 * what was raised, when, and whether an answer settled it.
 *
 * **Coverage, never a verdict.** `complete` and `insufficient` both mean "asked
 * and answered" here and are deliberately rendered identically. `insufficient`
 * is a coverage word — "we asked, and moved on" — and surfacing it per question
 * would put a per-question judgement back on the screen, which is exactly what
 * the 2026-08-22 decision removed. The score lives above, per rubric dimension,
 * read from the whole transcript.
 *
 * Pure: no I/O, no clock.
 */
import type { ScreeningTopicLedger } from "./topic-ledger";

/**
 * What to say about one question.
 *
 * - `answered` — the ledger settled it. The words are in the transcript.
 * - `unanswered` — it was raised and the call ended before an answer landed.
 * - `never_asked` — it sat `pending`: the call ended without it being put to
 *   the candidate at all. This is the one worth the recruiter's attention,
 *   because the rubric dimension behind it scored 0 for a question nobody
 *   asked.
 * - `not_in_call` — the ledger has no entry for it, so it was not part of this
 *   call (a question added to the campaign afterwards).
 * - `unrecorded` — a voice call with no ledger. Coverage was not tracked, so
 *   nothing can be claimed per question either way.
 * - `awaiting` — the link is out and the candidate has not called yet.
 * - `written` — a typed answer is on file (the legacy path).
 * - `no_response` — no call, no text, and the link is no longer live.
 */
export type ScreeningQuestionOutcome =
  | "answered"
  | "unanswered"
  | "never_asked"
  | "not_in_call"
  | "unrecorded"
  | "awaiting"
  | "written"
  | "no_response";

export interface ScreeningQuestionOutcomeInput {
  questionId: string;
  /** The response's status. `sent` means the candidate has not called yet. */
  responseStatus: string;
  /** True once a transcript exists — i.e. a call was actually taken. */
  isVoice: boolean;
  /** Non-empty when a typed answer is on file (legacy text path only). */
  answerText: string | null | undefined;
  /** The call's coverage record, or null when none was kept. */
  ledger: ScreeningTopicLedger | null;
}

/**
 * Decide what one question's line should say.
 *
 * Order matters. A typed answer is evidence in hand and outranks everything; a
 * ledger is checked before the response status so a completed call is read off
 * the record rather than off a status that only says the link was sent.
 */
export function screeningQuestionOutcome(
  input: ScreeningQuestionOutcomeInput,
): ScreeningQuestionOutcome {
  const { questionId, responseStatus, isVoice, answerText, ledger } = input;

  if (answerText && answerText.trim().length > 0) return "written";

  if (ledger) {
    const topic = ledger.topics.find((t) => t.id === questionId);
    if (!topic) return "not_in_call";

    switch (topic.status) {
      // Both mean asked and answered. `insufficient` is a statement about
      // coverage, not about the candidate — see the module note.
      case "complete":
      case "insufficient":
        return "answered";
      case "in_progress":
        return "unanswered";
      case "pending":
        // Still `pending` while the link is live means the call has not
        // happened yet, not that the question was skipped.
        return responseStatus === "sent" ? "awaiting" : "never_asked";
    }
  }

  // A call was taken but nothing tracked coverage: every response before the
  // ledger existed, and any campaign the control loop never ran for. The
  // transcript is the only record, and it is on the same page.
  if (isVoice) return "unrecorded";

  if (responseStatus === "sent") return "awaiting";

  return "no_response";
}

/** The line shown under each question. */
export const SCREENING_QUESTION_OUTCOME_COPY: Record<
  ScreeningQuestionOutcome,
  string
> = {
  answered: "Answered aloud — read it in the transcript above.",
  unanswered: "Asked, but the call ended before an answer was recorded.",
  never_asked:
    "Never asked — the call ended without this question being put to the candidate.",
  not_in_call: "Not part of this call — added to the campaign afterwards.",
  unrecorded:
    "This call kept no per-question record — read the transcript above.",
  awaiting: "Awaiting the candidate's call…",
  written: "",
  no_response: "Never answered.",
};

/**
 * Outcomes that mean a rubric dimension may have been graded on evidence that
 * was never solicited. The caller warns on these; a 0 for a question nobody
 * asked is not a fact about the candidate.
 */
export function isUnaskedOutcome(outcome: ScreeningQuestionOutcome): boolean {
  return outcome === "never_asked";
}
