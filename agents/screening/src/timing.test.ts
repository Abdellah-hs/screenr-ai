import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANSWER_BUDGET_MS,
  ANSWER_SETTLE_MS,
  CLOSE_HOLD_MS,
  FINAL_TURN_SETTLE_MS,
  SILENCE_NUDGE_MS,
  SPEAK_BACKSTOP_MS,
  SPEAK_HOLD_MS,
  answerSettleMs,
  controlTimeoutMs,
  screeningVadEagerness,
  GREETING_SETTLE_MS,
  greetingSettleMs,
  SUBSTANTIAL_ANSWER_WORDS,
  answerHoldMs,
} from "./timing.js";

const ORIGINAL_ENV = { ...process.env };

const APP_CONSTANTS = readFileSync(new URL("../../../src/lib/constants.ts", import.meta.url), "utf8");

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SCREENING_VAD_EAGERNESS;
  delete process.env.SCREENING_ANSWER_SETTLE_MS;
  delete process.env.SCREENING_CONTROL_TIMEOUT_MS;
  delete process.env.SCREENING_REPORT_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("ANSWER_BUDGET_MS", () => {
  /**
   * The duration is a shared decision with the app, and this test is the only
   * thing keeping the two copies honest. The worker ARMS the clock, because it
   * is the only party that can see when a question finished being spoken; the
   * app records the same number in the ledger.
   */
  it("matches the budget the app records", () => {
    const asSource = ANSWER_BUDGET_MS.toLocaleString("en-US").replace(/,/g, "_");

    expect(APP_CONSTANTS).toContain(`export const SCREENING_ANSWER_BUDGET_MS = ${asSource};`);
  });
});

describe("the minute is the minute", () => {
  /**
   * The budget expiring used to sit on the timer until the candidate stopped
   * talking — up to fifteen seconds. That is a second answer's worth of time
   * handed to the one person who had already used all of theirs, and it made
   * the counter a suggestion rather than a deadline.
   *
   * Retired on the app's side too, so it cannot be read as still in force. The
   * behaviour itself is driven end-to-end in machine.test.ts.
   */
  it("leaves no grace for the app to record", () => {
    expect(APP_CONSTANTS).not.toContain("SCREENING_ANSWER_GRACE_MS");
  });
});

describe("SILENCE_NUDGE_MS", () => {
  /**
   * The one failure `create_response: false` introduces. With OpenAI no longer
   * replying on its own, a worker that fails to speak leaves a room where
   * nothing will ever say anything again — and silence, unlike a wrong
   * question, is not recoverable.
   *
   * Generous, because the honest reading of silence at the greeting is a
   * candidate fighting a microphone permission dialog rather than one refusing
   * to speak. Shorter than a real answer's budget, so it can never be mistaken
   * for one.
   */
  it("waits long enough for somebody struggling with a microphone", () => {
    expect(SILENCE_NUDGE_MS).toBeGreaterThanOrEqual(15_000);
    expect(SILENCE_NUDGE_MS).toBeLessThan(ANSWER_BUDGET_MS);
  });
});

describe("SPEAK_BACKSTOP_MS", () => {
  /**
   * Generous against a real turn, which is one question. Overshooting means
   * walking away from a turn that might still be playing; deadlocking means the
   * candidate is abandoned mid-interview, since the speech lane is single-file
   * and a turn ends by enqueuing an event.
   */
  it("is long enough for a question and short enough to rescue a call", () => {
    expect(SPEAK_BACKSTOP_MS).toBeGreaterThan(SILENCE_NUDGE_MS);
    expect(SPEAK_BACKSTOP_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("the goodbye waits longer than a question", () => {
  /**
   * A held question delays the interview; a held goodbye delays only the ending
   * of a call that is already over — while cutting it short loses the
   * candidate's last words entirely, since the browser submits on the close.
   *
   * Both are bounded: a candidate who never stops would otherwise hold the room
   * open, close the tab, and be rejected by the expiry sweep for an interview
   * they actually sat.
   */
  it("gives the ending more room than the next question", () => {
    expect(CLOSE_HOLD_MS).toBeGreaterThan(SPEAK_HOLD_MS);
    expect(CLOSE_HOLD_MS).toBeLessThanOrEqual(30_000);
    expect(SPEAK_HOLD_MS).toBeGreaterThan(0);
  });
});

describe("FINAL_TURN_SETTLE_MS", () => {
  it("waits long enough for a slow transcription without stranding anyone", () => {
    // Far longer than the sub-second gap on a healthy call, short enough that a
    // candidate sitting through it is plainly still on a call.
    expect(FINAL_TURN_SETTLE_MS).toBeGreaterThanOrEqual(5_000);
    expect(FINAL_TURN_SETTLE_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("answerSettleMs", () => {
  /**
   * `eagerness: "low"` tunes how long the DETECTOR waits, and the detector is
   * reading one utterance rather than deciding whether an answer is over. This
   * is the worker declining to act on its verdict for a moment, and it is what
   * a live call reported the absence of: "it doesn't let me finish the answer",
   * with time still on the counter.
   */
  it("defaults to a window a thinking pause fits inside", () => {
    expect(answerSettleMs()).toBe(ANSWER_SETTLE_MS);
    expect(ANSWER_SETTLE_MS).toBeGreaterThanOrEqual(2_000);
  });

  it("takes an override, because this can only be judged on a real call", () => {
    process.env.SCREENING_ANSWER_SETTLE_MS = "5000";

    expect(answerSettleMs()).toBe(5_000);
  });

  /** Zero is the kill switch: act on the detector's verdict, as before. */
  it("allows the hold to be switched off", () => {
    process.env.SCREENING_ANSWER_SETTLE_MS = "0";

    expect(answerSettleMs()).toBe(0);
  });

  it("ignores a value it cannot read", () => {
    process.env.SCREENING_ANSWER_SETTLE_MS = "a while";

    expect(answerSettleMs()).toBe(ANSWER_SETTLE_MS);
  });

  /**
   * A hold is dead air on every answer, so a typo must not be able to turn the
   * call into one.
   */
  it("clamps a value that would stall the call", () => {
    process.env.SCREENING_ANSWER_SETTLE_MS = "600000";

    expect(answerSettleMs()).toBeLessThanOrEqual(10_000);
  });
});

describe("answerHoldMs", () => {
  /**
   * **The counter promises a minute and a three-second pause was spending it.**
   * A candidate who says "I don't know." and stops to think had their topic
   * settled on three words, with fifty-five seconds still on their screen.
   *
   * `null` is the worker declining to guess: their countdown carries the
   * answer, and the budget expiring flushes whatever is held.
   */
  it("does not end a barely-started answer on a pause", () => {
    expect(answerHoldMs(3, ANSWER_SETTLE_MS)).toBeNull();
    expect(answerHoldMs(0, ANSWER_SETTLE_MS)).toBeNull();
    expect(answerHoldMs(SUBSTANTIAL_ANSWER_WORDS - 1, ANSWER_SETTLE_MS)).toBeNull();
  });

  /**
   * A real answer keeps the ordinary window: waiting there is dead air on every
   * single question, and a pause after forty words really is an ending.
   */
  it("uses the ordinary window once they have actually answered", () => {
    expect(answerHoldMs(SUBSTANTIAL_ANSWER_WORDS, ANSWER_SETTLE_MS)).toBe(ANSWER_SETTLE_MS);
    expect(answerHoldMs(40, ANSWER_SETTLE_MS)).toBe(ANSWER_SETTLE_MS);
  });

  /** The kill switch stays a kill switch, however little was said. */
  it("holds nothing when the hold is switched off", () => {
    expect(answerHoldMs(1, 0)).toBe(0);
    expect(answerHoldMs(40, 0)).toBe(0);
  });

  /**
   * The threshold has to sit above a non-answer and below a real one. The
   * interviewer is forbidden from asking anything answerable with yes or no, so
   * a handful of words is the START of an answer rather than a short one.
   */
  it("puts the line above a non-answer", () => {
    expect(SUBSTANTIAL_ANSWER_WORDS).toBeGreaterThan("I don't really know".split(" ").length);
    expect(SUBSTANTIAL_ANSWER_WORDS).toBeLessThan(30);
  });
});

describe("greetingSettleMs", () => {
  /**
   * Reported from the chair: a delay after "do you hear me?".
   *
   * The reply to the audio check was held for the full answer window — three
   * seconds of nothing at the very top of the call, before transcription and
   * before the model generates the first question. A candidate who has just
   * joined cannot tell a thinking interviewer from a broken one, and this is
   * the moment they are most likely to decide it is broken.
   */
  it("is shorter than the window an interview answer gets", () => {
    expect(greetingSettleMs(ANSWER_SETTLE_MS)).toBe(GREETING_SETTLE_MS);
    expect(GREETING_SETTLE_MS).toBeLessThan(ANSWER_SETTLE_MS);
  });

  /**
   * Not zero: a candidate who says "yes —" and keeps going must not be asked
   * topic 1 over the top of themselves. With barge-in on, that question is
   * cancelled partway through and its minute armed on one they only half heard.
   */
  it("still holds long enough for somebody resuming a sentence", () => {
    expect(greetingSettleMs(ANSWER_SETTLE_MS)).toBeGreaterThanOrEqual(500);
  });

  /** Switching the hold off switches it off everywhere, including here. */
  it("is off when the answer hold is off", () => {
    expect(greetingSettleMs(0)).toBe(0);
  });

  /**
   * Lengthening the hold for interview answers must not lengthen the pause
   * after "can you hear me?" — the one place a longer hold buys nothing.
   */
  it("never grows past its own bound", () => {
    expect(greetingSettleMs(10_000)).toBe(GREETING_SETTLE_MS);
  });
});

describe("screeningVadEagerness", () => {
  /**
   * It matters MORE under the push protocol, not less. A turn ending is now the
   * event that decides the next question, so an eager detector does not merely
   * interrupt — it spends a topic on half an answer.
   */
  it("defaults to the patient setting an interview answer needs", () => {
    expect(screeningVadEagerness()).toBe("low");
  });

  it("ignores a value it does not recognise", () => {
    process.env.SCREENING_VAD_EAGERNESS = "aggressive";

    expect(screeningVadEagerness()).toBe("low");
  });

  it("takes an override, because this can only be judged on a real call", () => {
    process.env.SCREENING_VAD_EAGERNESS = "high";

    expect(screeningVadEagerness()).toBe("high");
  });
});

describe("controlTimeoutMs", () => {
  /**
   * The two events that decide the next question also run the turn evaluator —
   * an OpenAI round-trip on top of the database ones. Holding them to the short
   * budget is what made every evaluation abort on the first real call: the
   * reads were fine, the model was not, and the ledger silently learned nothing
   * about any answer.
   */
  it("gives the events that decide the next question far more time", () => {
    expect(controlTimeoutMs(true)).toBeGreaterThan(controlTimeoutMs(false));
    // Comfortably past a model round-trip, which is what the bug missed.
    expect(controlTimeoutMs(true)).toBeGreaterThanOrEqual(15_000);
  });

  it("takes an override for each budget separately", () => {
    process.env.SCREENING_REPORT_TIMEOUT_MS = "30000";
    process.env.SCREENING_CONTROL_TIMEOUT_MS = "3000";

    expect(controlTimeoutMs(true)).toBe(30_000);
    expect(controlTimeoutMs(false)).toBe(3_000);
  });

  it("ignores an override it cannot read", () => {
    process.env.SCREENING_CONTROL_TIMEOUT_MS = "soon";

    expect(controlTimeoutMs(false)).toBe(6_000);
  });
});
