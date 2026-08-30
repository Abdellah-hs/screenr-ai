import { describe, expect, it } from "vitest";
import {
  GOODBYE_INSTRUCTIONS,
  greetingInstructions,
  TECHNICAL_FAILURE_INSTRUCTIONS,
  goodbyeInstructions,
  instructionForQuestion,
  technicalFailureInstructions,
} from "./prompts.js";

describe("instructionForQuestion", () => {
  /**
   * The question text travels on the state, and the wording is put back around
   * it at the one moment the interviewer is about to open its mouth.
   *
   * **There is one wording.** It used to take a kind, because a probe was asked
   * differently from a topic. Follow-ups are gone, so every question is a topic
   * and there is nothing to choose between.
   */
  it("hands over the recruiter's question verbatim, to be reworded not read", () => {
    const text = instructionForQuestion("Tell me about a system you scaled.", null);

    expect(text).toContain("Tell me about a system you scaled.");
    expect(text).toContain("your own words");
    expect(text).toContain("never read it out as written");
  });

  /**
   * A Realtime model asked for a turn will happily deliver a question and then
   * answer it. The candidate's own words are the only thing this stage scores.
   */
  it("always ends the turn on the question", () => {
    expect(instructionForQuestion("Q", null)).toContain("STOP TALKING");
  });

  /**
   * **Nothing asks the interviewer to probe any more**, and this is what keeps
   * it that way: the wording it is handed is the only thing that ever invited
   * one, and an invitation in the prompt is what made the old follow-up budget
   * unenforceable — the model probed after every answer without telling anyone.
   */
  it("never invites a follow-up", () => {
    const text = instructionForQuestion("Q", null).toLowerCase();

    expect(text).not.toContain("follow-up");
    expect(text).not.toContain("probe");
  });
});

/**
 * **Repeated on every turn, not set once at the top of the call.** The
 * questions reach the interviewer in English — that is the language they are
 * STORED in — so every single turn of a French call pulls it back toward
 * English. Naming the language beside the question is what stops the drift.
 */
describe("the language the candidate chose", () => {
  it("is named on every question", () => {
    const french = instructionForQuestion("Tell me about a migration.", "french");

    expect(french).toContain("Speak French");
    expect(french).toContain("Never switch");
    // And the question is still handed over verbatim.
    expect(french).toContain("Tell me about a migration.");
  });

  it("says which language the question text is in, so it is translated", () => {
    expect(instructionForQuestion("Q", "french")).toContain("written in English");
  });

  /**
   * They answered the audio check without naming one. Pinning English there
   * would open an interview in a language somebody plainly is not using;
   * unpinned, the model matches them, which is right when we do not know.
   */
  it("is left unpinned when they named none", () => {
    expect(instructionForQuestion("Q", null)).not.toContain("Speak English");
    expect(instructionForQuestion("Q", null)).not.toContain("Speak French");
  });

  /** The ending is in their language too, or the call changes language to say goodbye. */
  it("carries through to the goodbye and the failure sentence", () => {
    expect(goodbyeInstructions("french")).toContain("Speak French");
    expect(goodbyeInstructions("french")).toContain(GOODBYE_INSTRUCTIONS);
    expect(technicalFailureInstructions("english")).toContain("Speak English");
    expect(technicalFailureInstructions(null)).toBe(TECHNICAL_FAILURE_INSTRUCTIONS);
  });
});

describe("greetingInstructions(null)", () => {
  /**
   * Greeting-only, and it stops. It used to be told to greet AND ask topic 1,
   * which invited exactly what a live call produced: "I can hear you clearly —
   * hope you can hear me well too", and then silence, while the ledger recorded
   * topic 1 as asked and started its clock on a hello. An audio check nobody is
   * allowed to answer is not a check.
   */
  it("asks the audio check and nothing else", () => {
    expect(greetingInstructions(null)).toContain("hear you clearly");
    expect(greetingInstructions(null)).toContain("no interview question yet");
    expect(greetingInstructions(null)).toContain("stop talking");
  });

  /**
   * **The one turn that used to infer a language.** The interviewer is given
   * the candidate's name and a summary of their CV, and it read those and
   * opened the call in French at somebody who wanted English — before they had
   * said a word. The candidate now picks before the room is created, so the
   * greeting is spoken in their choice rather than in a guess about them.
   */
  it("is spoken in the language the candidate picked", () => {
    expect(greetingInstructions("french")).toContain("Speak French");
    expect(greetingInstructions("french")).toContain("hear you clearly");
  });

  /** Nothing is asked about language: it was settled before the call opened. */
  it("never asks the candidate which language they want", () => {
    const text = greetingInstructions("english").toLowerCase();

    expect(text).not.toContain("would you");
    expect(text).not.toContain("prefer");
    expect(text).not.toContain("or in french");
  });
});

describe("GOODBYE_INSTRUCTIONS", () => {
  /**
   * The room closes on this turn and the browser submits when it does, so a
   * question here is put to somebody who is then hung up on mid-thought.
   *
   * **Asserted positively, because the negation is what failed.** "Do not ask
   * them anything further" was in this prompt for the whole time the bug was
   * live: closing an interview by inviting questions is one of the strongest
   * habits a model has, and a negation is the weakest way to argue with one.
   * The instruction now says what the last sentence must BE, and names the two
   * forms the question actually took.
   */
  it("requires the last sentence to be a statement", () => {
    expect(GOODBYE_INSTRUCTIONS).toContain("must be a STATEMENT");
    expect(GOODBYE_INSTRUCTIONS).toContain("never a question");
  });

  it("names the two questions it kept asking", () => {
    expect(GOODBYE_INSTRUCTIONS).toContain("whether they have questions for you");
    expect(GOODBYE_INSTRUCTIONS).toContain("anything they would like to add");
  });

  /**
   * A refusal with nowhere to put the impulse is one a model routes around, so
   * the candidate's questions are given a real answer to be sent to.
   */
  it("says where a real question goes instead", () => {
    expect(GOODBYE_INSTRUCTIONS).toContain("hiring team will cover it by email");
  });

  /**
   * The browser submits on the finished packet. Telling the candidate to click
   * or hang up sends them looking for a control that is not there, and the ones
   * who close the tab first are left at `screening_sent` with a completed
   * interview behind them.
   */
  it("never asks the candidate to do anything", () => {
    expect(GOODBYE_INSTRUCTIONS).toContain("tell them to click or press anything");
  });
});

describe("TECHNICAL_FAILURE_INSTRUCTIONS", () => {
  /**
   * `FAILED` is not silence. A candidate whose interview stops has to be told
   * something — but the room is about to close, so a question here would be
   * answered into nothing, and there is no button for them to press.
   */
  it("says one short thing and ends the turn", () => {
    expect(TECHNICAL_FAILURE_INSTRUCTIONS).toContain("one short sentence");
    expect(TECHNICAL_FAILURE_INSTRUCTIONS).toContain("stop talking");
    expect(TECHNICAL_FAILURE_INSTRUCTIONS).toContain("Do not ask them anything");
    expect(TECHNICAL_FAILURE_INSTRUCTIONS).toContain("do not tell them to click or press anything");
  });

  /**
   * Whether they get another link is the recruiter's decision. Promising one
   * the product cannot keep is worse than saying nothing — and blaming their
   * connection for our outage is worse still.
   */
  it("promises nothing and blames nobody", () => {
    expect(TECHNICAL_FAILURE_INSTRUCTIONS).not.toMatch(/try again|reconnect|refresh/i);
    expect(TECHNICAL_FAILURE_INSTRUCTIONS).toContain("do not blame them or their connection");
  });
});
