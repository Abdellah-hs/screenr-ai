import { describe, it, expect } from "vitest";
import {
  assertResponseIsOpen,
  assertResponseNotResubmitted,
  validateRequiredAnswersPresent,
  ScreeningResponseError,
  type ScreeningResponseStatus,
} from "./screening-response";

const OPEN_STATUSES: ScreeningResponseStatus[] = ["pending", "sent", "responded"];

describe("assertResponseIsOpen", () => {
  it.each(OPEN_STATUSES)("does not throw when status is %s", (status) => {
    expect(() => assertResponseIsOpen(status)).not.toThrow();
  });

  it("throws the candidate-facing 'already submitted' message when status is scored", () => {
    expect(() => assertResponseIsOpen("scored")).toThrow(ScreeningResponseError);
    expect(() => assertResponseIsOpen("scored")).toThrow(
      "Your answers have already been submitted and reviewed. Thank you!",
    );
  });

  it("throws the candidate-facing 'expired' message when status is expired", () => {
    expect(() => assertResponseIsOpen("expired")).toThrow(ScreeningResponseError);
    expect(() => assertResponseIsOpen("expired")).toThrow(
      "This link has expired. Please contact the hiring team for a new one.",
    );
  });
});

describe("assertResponseNotResubmitted", () => {
  it.each(OPEN_STATUSES)("does not throw for %s (submission is allowed)", (status) => {
    expect(() => assertResponseNotResubmitted(status)).not.toThrow();
  });

  it("does not throw for expired (the load path blocks that earlier)", () => {
    expect(() => assertResponseNotResubmitted("expired")).not.toThrow();
  });

  it("throws the 'cannot re-submit' message when status is scored", () => {
    expect(() => assertResponseNotResubmitted("scored")).toThrow(ScreeningResponseError);
    expect(() => assertResponseNotResubmitted("scored")).toThrow(
      "Your answers have already been submitted. You cannot re-submit.",
    );
  });
});

describe("validateRequiredAnswersPresent", () => {
  const q = (id: string, is_required: boolean) => ({ id, is_required });
  const a = (question_id: string) => ({ question_id });

  it("passes when no questions are configured", () => {
    expect(() => validateRequiredAnswersPresent([], [])).not.toThrow();
  });

  it("passes when optional questions are unanswered", () => {
    const questions = [q("q1", false), q("q2", false)];
    expect(() => validateRequiredAnswersPresent(questions, [])).not.toThrow();
  });

  it("passes when every required question has an answer", () => {
    const questions = [q("q1", true), q("q2", true), q("q3", false)];
    const answers = [a("q1"), a("q2")];
    expect(() => validateRequiredAnswersPresent(questions, answers)).not.toThrow();
  });

  it("throws when a single required question is missing", () => {
    const questions = [q("q1", true), q("q2", true)];
    const answers = [a("q1")];

    expect(() => validateRequiredAnswersPresent(questions, answers)).toThrow(
      ScreeningResponseError,
    );
    expect(() => validateRequiredAnswersPresent(questions, answers)).toThrow(
      "Please answer every required question before submitting (1 missing).",
    );
  });

  it("throws with the correct count when multiple required questions are missing", () => {
    const questions = [q("q1", true), q("q2", true), q("q3", true)];
    const answers = [a("q1")];

    expect(() => validateRequiredAnswersPresent(questions, answers)).toThrow(
      "Please answer every required question before submitting (2 missing).",
    );
  });

  it("ignores answers to unknown questions (caller is responsible for rejecting them)", () => {
    const questions = [q("q1", true)];
    const answers = [a("q1"), a("q-unknown")];
    expect(() => validateRequiredAnswersPresent(questions, answers)).not.toThrow();
  });
});
