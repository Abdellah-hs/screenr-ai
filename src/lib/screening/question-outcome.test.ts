import { describe, expect, it } from "vitest";
import {
  isUnaskedOutcome,
  SCREENING_QUESTION_OUTCOME_COPY,
  screeningQuestionOutcome,
  type ScreeningQuestionOutcomeInput,
} from "./question-outcome";
import type {
  ScreeningTopic,
  ScreeningTopicLedger,
  ScreeningTopicStatus,
} from "./topic-ledger";

function topic(
  id: string,
  status: ScreeningTopicStatus,
  number = 1,
): ScreeningTopic {
  return {
    id,
    number,
    prompt: `Question ${number}`,
    status,
    askedAt: status === "pending" ? null : "2026-08-28T10:00:00.000Z",
    completedAt:
      status === "complete" || status === "insufficient"
        ? "2026-08-28T10:01:00.000Z"
        : null,
    evidenceSummary: null,
  };
}

function ledgerOf(topics: ScreeningTopic[]): ScreeningTopicLedger {
  return {
    rulesVersion: "v4_correctable_stamp",
    version: 3,
    currentTopicId: null,
    topics,
    phase: "finished",
    startedAt: "2026-08-28T10:00:00.000Z",
    deadlineAt: "2026-08-28T10:30:00.000Z",
    wrapUpAt: "2026-08-28T10:29:00.000Z",
    answerDueAt: null,
    answerStartedAt: null,
    handledEventIds: [],
    evaluatorFailures: 0,
    unheardAnswers: 0,
  };
}

function input(
  over: Partial<ScreeningQuestionOutcomeInput> = {},
): ScreeningQuestionOutcomeInput {
  return {
    questionId: "q1",
    responseStatus: "scored",
    isVoice: true,
    answerText: "",
    ledger: null,
    ...over,
  };
}

describe("screeningQuestionOutcome", () => {
  it("reports a settled topic as answered even though no per-question score exists", () => {
    // The regression this module exists for: a rubric-era voice call writes
    // neither `answer_text` nor `answers[].score`, so the old check read every
    // answered question as "Never answered."
    const outcome = screeningQuestionOutcome(
      input({ ledger: ledgerOf([topic("q1", "complete")]) }),
    );

    expect(outcome).toBe("answered");
  });

  it("reads a thin answer as answered, not as a per-question verdict", () => {
    const outcome = screeningQuestionOutcome(
      input({ ledger: ledgerOf([topic("q1", "insufficient")]) }),
    );

    expect(outcome).toBe("answered");
  });

  it("distinguishes a question that was asked but never answered", () => {
    const outcome = screeningQuestionOutcome(
      input({ ledger: ledgerOf([topic("q1", "in_progress")]) }),
    );

    expect(outcome).toBe("unanswered");
  });

  it("names a question the call never raised", () => {
    const outcome = screeningQuestionOutcome(
      input({ ledger: ledgerOf([topic("q1", "pending")]) }),
    );

    expect(outcome).toBe("never_asked");
  });

  it("does not call a pending topic skipped while the link is still live", () => {
    const outcome = screeningQuestionOutcome(
      input({
        responseStatus: "sent",
        isVoice: false,
        ledger: ledgerOf([topic("q1", "pending")]),
      }),
    );

    expect(outcome).toBe("awaiting");
  });

  it("marks a question the ledger never held as outside the call", () => {
    const outcome = screeningQuestionOutcome(
      input({
        questionId: "q-added-later",
        ledger: ledgerOf([topic("q1", "complete")]),
      }),
    );

    expect(outcome).toBe("not_in_call");
  });

  it("claims nothing per question for a call with no coverage record", () => {
    const outcome = screeningQuestionOutcome(input({ ledger: null }));

    expect(outcome).toBe("unrecorded");
  });

  it("prefers a typed answer over the ledger", () => {
    const outcome = screeningQuestionOutcome(
      input({
        answerText: "I led the migration over two quarters.",
        ledger: ledgerOf([topic("q1", "pending")]),
      }),
    );

    expect(outcome).toBe("written");
  });

  it("treats whitespace as no typed answer", () => {
    const outcome = screeningQuestionOutcome(
      input({ answerText: "   \n ", isVoice: false, responseStatus: "expired" }),
    );

    expect(outcome).toBe("no_response");
  });

  it("still reports a never-returned link as never answered", () => {
    const outcome = screeningQuestionOutcome(
      input({ isVoice: false, responseStatus: "expired" }),
    );

    expect(outcome).toBe("no_response");
  });

  it("waits on a candidate who has not called yet", () => {
    const outcome = screeningQuestionOutcome(
      input({ isVoice: false, responseStatus: "sent" }),
    );

    expect(outcome).toBe("awaiting");
  });
});

describe("SCREENING_QUESTION_OUTCOME_COPY", () => {
  it("never claims a question went unanswered when the ledger settled it", () => {
    expect(SCREENING_QUESTION_OUTCOME_COPY.answered).not.toMatch(/never/i);
  });

  it("says who failed to ask, not who failed to answer, for a skipped topic", () => {
    expect(SCREENING_QUESTION_OUTCOME_COPY.never_asked).toMatch(/never asked/i);
  });

  it("has a line for every outcome except the one that renders the answer itself", () => {
    const blank = Object.entries(SCREENING_QUESTION_OUTCOME_COPY)
      .filter(([, line]) => line.length === 0)
      .map(([key]) => key);

    expect(blank).toEqual(["written"]);
  });
});

describe("isUnaskedOutcome", () => {
  it("flags only the topic the call never raised", () => {
    expect(isUnaskedOutcome("never_asked")).toBe(true);
    expect(isUnaskedOutcome("answered")).toBe(false);
    expect(isUnaskedOutcome("unanswered")).toBe(false);
    expect(isUnaskedOutcome("unrecorded")).toBe(false);
  });
});
