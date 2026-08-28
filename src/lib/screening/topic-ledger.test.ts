import { describe, expect, it } from "vitest";
import {
  applyAnswerStarted,
  applyAnswerTimeout,
  applyAnswerUnheard,
  applyEvaluatorFailure,
  beginNextTopic,
  createTopicLedger,
  currentDirective,
  decideNextInterviewAction,
  earliestPendingTopic,
  enterWrapUp,
  remainingUnasked,
  resolveCloseRequest,
  type LedgerQuestion,
  type ScreeningTopicLedger,
  type TopicTurnDecision,
} from "./topic-ledger";

const START = "2026-08-24T10:00:00.000Z";

function questions(count: number): LedgerQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q${i + 1}`,
    prompt: `Topic ${i + 1} question`,
  }));
}

function ledgerOf(count: number): ScreeningTopicLedger {
  return createTopicLedger({ questions: questions(count), startedAt: START });
}

function decision(over: Partial<TopicTurnDecision> = {}): TopicTurnDecision {
  return {
    addressedTopicNumber: null,
    topicStatus: "complete",
    evidenceSummary: "Described a concrete migration they led.",
    confidence: "high",
    ...over,
  };
}

/** Raise and settle every topic but the last, which is left unraised. */
function runWholeCallExceptLast(start: ScreeningTopicLedger): ScreeningTopicLedger {
  let ledger = start;
  for (let i = 0; i < start.topics.length - 1; i++) {
    ledger = beginNextTopic(ledger, START, `ask-${i}`).ledger;
    ledger = decideNextInterviewAction(
      ledger,
      decision({ topicStatus: "complete" }),
      START,
      `turn-${i}`,
    ).ledger;
  }
  return ledger;
}

/** Raise and settle every topic, the way a clean call would. */
function runWholeCall(start: ScreeningTopicLedger): ScreeningTopicLedger {
  let ledger = start;
  for (let i = 0; i < start.topics.length; i++) {
    ledger = beginNextTopic(ledger, START, `ask-${i}`).ledger;
    ledger = decideNextInterviewAction(
      ledger,
      decision({ topicStatus: "complete" }),
      START,
      `turn-${i}`,
    ).ledger;
  }
  return ledger;
}

describe("createTopicLedger", () => {
  it("starts every topic pending, numbered in the configured order", () => {
    const ledger = ledgerOf(3);

    expect(ledger.topics.map((t) => [t.number, t.id, t.status])).toEqual([
      [1, "q1", "pending"],
      [2, "q2", "pending"],
      [3, "q3", "pending"],
    ]);
    expect(ledger.phase).toBe("interviewing");
    expect(ledger.currentTopicId).toBeNull();
  });

  /**
   * **A topic carries no probe budget, because there are no probes**
   * (decision 2026-08-27). A call is one question, one answer, the next
   * question — so a per-topic allowance would be a number describing a rule
   * that no longer exists, which is worse than no number at all.
   */
  it("gives a topic no follow-up allowance to spend", () => {
    const topic = ledgerOf(4).topics[0]!;

    expect(topic).not.toHaveProperty("maxFollowUps");
    expect(topic).not.toHaveProperty("followUpsUsed");
  });

  /**
   * Wrap-up is a reserve carved out of the call's own budget, so it must always
   * fall inside it — including for the shortest possible call, where a naive
   * subtraction could land before the greeting.
   */
  it("places the wrap-up line inside the call, never before it starts", () => {
    const ledger = ledgerOf(3);

    expect(Date.parse(ledger.wrapUpAt)).toBeGreaterThanOrEqual(Date.parse(START));
    expect(Date.parse(ledger.wrapUpAt)).toBeLessThan(Date.parse(ledger.deadlineAt));
  });
});

describe("beginNextTopic", () => {
  it("raises the earliest pending topic and stamps when it was asked", () => {
    const { ledger, directive } = beginNextTopic(ledgerOf(3), START);

    expect(directive.task).toBe("ask_primary_question");
    expect(directive.topicNumber).toBe(1);
    expect(ledger.topics[0]?.status).toBe("in_progress");
    expect(ledger.topics[0]?.askedAt).toBe(START);
    expect(ledger.currentTopicId).toBe("q1");
  });

  /**
   * The worker retries a control call that timed out, so the same request can
   * arrive twice. Burning a second topic on one spoken question would leave the
   * skipped one marked asked and never actually raised — a gap that is
   * invisible from the transcript and scores the candidate zero.
   */
  it("returns the same topic when asked again before it has been answered", () => {
    const first = beginNextTopic(ledgerOf(3), START, "req-1");
    const second = beginNextTopic(first.ledger, START, "req-2");

    expect(second.directive.topicNumber).toBe(1);
    expect(second.ledger.topics[1]?.status).toBe("pending");
  });

  /**
   * The complement of the guard above, and the bug it was hiding.
   *
   * The interviewer calls `next_topic` about half a second after the candidate
   * stops; `turn_completed` is an OpenAI round-trip three to five seconds
   * behind it. So the ordinary order is "asked for the next topic while the
   * last one is still open" — and the duplicate guard swallowed every one of
   * them. The next topic was never raised, so `answerDueAt` was never re-armed
   * and the candidate's countdown vanished after their first answer and never
   * returned; the topic stayed `pending` for the rest of the call and scored
   * them zero. The interviewer had spent its tool call, so nothing raised it
   * later either.
   */
  it("advances when the candidate has already answered the open topic", () => {
    const asked = beginNextTopic(ledgerOf(3), START, "req-1").ledger;
    const answering = applyAnswerStarted(asked, START, "speech-1").ledger;

    const next = beginNextTopic(answering, START, "req-2");

    expect(next.directive.topicNumber).toBe(2);
    expect(next.ledger.topics[0]?.status).toBe("complete");
    expect(next.ledger.topics[1]?.status).toBe("in_progress");
  });

  /**
   * Raising the next topic has to re-arm the clock, because that is the only
   * thing that puts a countdown back on the candidate's screen: while nothing
   * is open, `applyAnswerStarted` and `applyAnswerTimeout` are both no-ops.
   */
  it("re-arms the answer clock when it advances past an answered topic", () => {
    const asked = beginNextTopic(ledgerOf(3), START, "req-1").ledger;
    const answering = applyAnswerStarted(asked, START, "speech-1").ledger;

    const next = beginNextTopic(answering, START, "req-2");

    expect(next.ledger.answerDueAt).not.toBeNull();
    expect(next.ledger.answerStartedAt).toBeNull();
  });

  /**
   * A settle forced by the interviewer moving on is `complete`, not
   * `insufficient` — the same call `applyEvaluatorFailure` makes. The candidate
   * answered; our evaluator being slower than the conversation says nothing
   * about what they said, and this record is read by a person later.
   */
  it("does not put our own latency on the candidate's file", () => {
    const asked = beginNextTopic(ledgerOf(3), START, "req-1").ledger;
    const answering = applyAnswerStarted(asked, START, "speech-1").ledger;

    const next = beginNextTopic(answering, START, "req-2");

    expect(next.ledger.topics[0]?.status).toBe("complete");
  });

  it("replays the stored directive for an event id it has already handled", () => {
    const first = beginNextTopic(ledgerOf(3), START, "req-1");
    const replay = beginNextTopic(first.ledger, START, "req-1");

    expect(replay.ledger).toBe(first.ledger);
    expect(replay.directive.topicNumber).toBe(1);
  });
});

describe("decideNextInterviewAction", () => {
  it("records the evidence summary and advances when a topic is complete", () => {
    const opened = beginNextTopic(ledgerOf(3), START).ledger;
    const { ledger, directive } = decideNextInterviewAction(
      opened,
      decision({ topicStatus: "complete", evidenceSummary: "Named Kafka, gave throughput figures." }),
      START,
    );

    expect(ledger.topics[0]?.status).toBe("complete");
    expect(ledger.topics[0]?.evidenceSummary).toBe("Named Kafka, gave throughput figures.");
    expect(directive.task).toBe("ask_primary_question");
    expect(directive.topicNumber).toBe(2);
  });

  /**
   * **Every answer settles its topic, however thin it was** (decision
   * 2026-08-27). There used to be a branch that kept the topic open and spent a
   * probe, bounded by a per-topic allowance. All of it is gone: one question,
   * one answer, the next question.
   *
   * The cost is depth on a vague answer, and it is real. What it buys is a call
   * with nothing to reason about — and time, since a probe spent a whole extra
   * minute re-asking a topic already covered, while the evidence for a rubric
   * dimension is read from the WHOLE transcript rather than from one answer.
   */
  it("moves on after one answer, however thin it was", () => {
    const opened = beginNextTopic(ledgerOf(3), START).ledger;

    const { ledger, directive } = decideNextInterviewAction(
      opened,
      decision({ topicStatus: "insufficient", evidenceSummary: "Spoke only in generalities." }),
      START,
      "t1",
    );

    expect(ledger.topics[0]?.status).toBe("insufficient");
    expect(ledger.topics[0]?.completedAt).toBe(START);
    expect(directive.task).toBe("ask_primary_question");
    expect(directive.topicNumber).toBe(2);
  });

  it("marks a topic insufficient when the evaluator says so outright", () => {
    const opened = beginNextTopic(ledgerOf(3), START).ledger;
    const { ledger } = decideNextInterviewAction(
      opened,
      decision({ topicStatus: "insufficient", evidenceSummary: "Declined to answer." }),
      START,
    );

    expect(ledger.topics[0]?.status).toBe("insufficient");
  });

  /**
   * Duplicate finalized-turn events are a normal fact of the Realtime pipeline,
   * not an error case. Settling one answer twice would advance the call by two
   * topics on one spoken answer, leaving the skipped one asked by nobody.
   */
  it("settles a topic once when the same turn arrives twice", () => {
    const opened = beginNextTopic(ledgerOf(3), START).ledger;

    const once = decideNextInterviewAction(opened, decision(), START, "turn-42");
    const twice = decideNextInterviewAction(once.ledger, decision(), START, "turn-42");

    expect(once.ledger.topics[1]?.status).toBe("pending");
    expect(twice.ledger.topics[1]?.status).toBe("pending");
    expect(twice.ledger.version).toBe(once.ledger.version);
  });

  /**
   * The interviewer is told to call `next_topic` first, but a model's tool
   * discipline is not a guarantee. Without this reconciliation a topic it
   * raised silently would stay `pending` forever and the close guard would
   * refuse to let the call end at all.
   */
  it("marks a topic raised when the evaluator saw it asked without a tool call", () => {
    const opened = beginNextTopic(ledgerOf(3), START).ledger;
    const { ledger } = decideNextInterviewAction(
      opened,
      decision({ addressedTopicNumber: 3, topicStatus: "complete" }),
      START,
    );

    expect(ledger.topics[2]?.status).toBe("complete");
    expect(ledger.topics[2]?.askedAt).toBe(START);
  });

  it("ignores a reading that names a topic already settled", () => {
    const done = runWholeCall(ledgerOf(3));
    const { ledger } = decideNextInterviewAction(
      done,
      decision({ addressedTopicNumber: 1, topicStatus: "insufficient" }),
      START,
      "late",
    );

    expect(ledger.topics[0]?.status).toBe("complete");
  });
});

describe("decideNextInterviewAction — late readings", () => {
  /**
   * Evaluating a turn is an OpenAI round-trip of two to four seconds, and the
   * interviewer asks for its next topic within about half a second. The tool
   * therefore runs in its own lane, and a verdict routinely lands after the
   * call has already moved on.
   *
   * Applying it then would grade one answer against a different question — the
   * single worst thing this module could do quietly. So a late reading may only
   * annotate the topic it was actually about.
   */
  it("does not let a stale verdict settle the topic that is now open", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger; // topic 1 open
    ledger = decideNextInterviewAction(ledger, decision(), START, "t1").ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger; // topic 2 now open

    // A reading about topic 1 arrives now, saying it was insufficient.
    const { ledger: after, directive } = decideNextInterviewAction(
      ledger,
      decision({ topicStatus: "insufficient", evidenceSummary: "Vague." }),
      START,
      "late-1",
      "q1",
    );

    expect(after.topics[1]?.status).toBe("in_progress");
    expect(after.currentTopicId).toBe("q2");
    expect(directive.topicNumber).toBe(2);
  });

  it("still records what the late reading found, on the topic it was about", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = decideNextInterviewAction(
      ledger,
      decision({ evidenceSummary: "" }),
      START,
      "t1",
    ).ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ evidenceSummary: "Named Kafka and gave figures." }),
      START,
      "late-1",
      "q1",
    );

    expect(after.topics[0]?.evidenceSummary).toBe("Named Kafka and gave figures.");
  });

  /**
   * A summary written with the flow — by the wrap-up settle, or the
   * evaluator-failure fallback — was recorded knowing what was happening. A
   * reading that turned up afterwards does not get to overwrite it.
   */
  it("never overwrites a summary that was written with the flow", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyEvaluatorFailure(ledger, START, "fail-1").ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ evidenceSummary: "Late reading." }),
      START,
      "late-1",
      "q1",
    );

    expect(after.topics[0]?.evidenceSummary).toMatch(/not evaluated/i);
  });

  it("applies normally when the topic it was about is still the open one", () => {
    const ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ topicStatus: "complete" }),
      START,
      "t1",
      "q1",
    );

    expect(after.topics[0]?.status).toBe("complete");
  });
});

describe("enterWrapUp", () => {
  /** Crossing the reserve is the last chance to raise anything still unasked. */
  it("raises every remaining topic once", () => {
    let ledger = beginNextTopic(ledgerOf(5), START).ledger;
    ledger = enterWrapUp(ledger, START).ledger;

    expect(ledger.phase).toBe("wrapping_up");

    const raised: number[] = [];
    for (let i = 0; i < 10 && remainingUnasked(ledger) > 0; i++) {
      const step = beginNextTopic(ledger, START, `wrap-ask-${i}`);
      ledger = step.ledger;
      raised.push(step.directive.topicNumber ?? -1);

      const turn = decideNextInterviewAction(
        ledger,
        decision({ topicStatus: "insufficient" }),
        START,
        `wrap-turn-${i}`,
      );
      ledger = turn.ledger;
    }

    expect(raised).toEqual([2, 3, 4, 5]);
    expect(remainingUnasked(ledger)).toBe(0);
  });

  /**
   * A topic open when the reserve is crossed was asked and not answered — the
   * candidate never got to it, or is mid-answer. It is settled rather than
   * abandoned, so the close guard can let the call end.
   */
  it("settles the topic in progress rather than abandoning it", () => {
    const ledger = beginNextTopic(ledgerOf(3), START).ledger;

    const { ledger: wrapped } = enterWrapUp(ledger, START, "wrap");

    expect(wrapped.topics[0]?.status).toBe("insufficient");
    expect(wrapped.topics[0]?.completedAt).toBe(START);
    expect(wrapped.currentTopicId).not.toBe("q1");
  });
});

describe("resolveCloseRequest", () => {
  /**
   * This is the guard the whole module exists to hold. A close accepted while a
   * topic is pending scores that topic zero for a candidate nobody ever asked.
   */
  it("refuses to close while any topic is still pending", () => {
    const result = resolveCloseRequest(ledgerOf(3), START);

    expect(result.allowed).toBe(false);
    expect(result.directive.task).toBe("ask_primary_question");
  });

  it("answers a refused close with the earliest pending topic, in configured order", () => {
    let ledger = ledgerOf(4);
    // Raise and settle topics 1 and 3, leaving 2 as the earliest gap.
    ledger = beginNextTopic(ledger, START, "a1").ledger;
    ledger = decideNextInterviewAction(ledger, decision(), START, "t1").ledger;
    ledger = decideNextInterviewAction(
      ledger,
      decision({ addressedTopicNumber: 3 }),
      START,
      "t3",
    ).ledger;

    const result = resolveCloseRequest(ledger, START, "close-1");

    expect(result.allowed).toBe(false);
    expect(result.directive.topicNumber).toBe(2);
  });

  it("allows the close once every topic has been raised and settled", () => {
    const result = resolveCloseRequest(runWholeCall(ledgerOf(3)), START, "close-1");

    expect(result.allowed).toBe(true);
    expect(result.directive.task).toBe("close");
    expect(result.ledger.phase).toBe("finished");
  });

  /**
   * The hole this guard had until 2026-08-25, and the reason the LAST question
   * of every call was the one most likely to be cut short.
   *
   * The guard looked only at `pending` — topics never raised — so a question
   * that had been ASKED did not block anything. The interviewer raises the last
   * topic, sees "topics not yet raised: 0", calls `end_interview` before the
   * candidate has drawn breath, and the allow path nulls `answerDueAt`: their
   * minute is gone, the countdown disappears, and the call ends on "Goodbye!"
   * over a question nobody answered.
   */
  it("refuses to close over a question the candidate has not answered", () => {
    const asked = beginNextTopic(runWholeCallExceptLast(ledgerOf(3)), START, "ask-3");

    const result = resolveCloseRequest(asked.ledger, START, "close-1");

    expect(result.allowed).toBe(false);
    expect(result.directive.task).toBe("await_answer");
  });

  /**
   * The refusal must not cost the candidate the very thing it is protecting.
   * Nothing is written on that path — above all not `answerDueAt`, so the
   * minute keeps running straight through it.
   */
  it("leaves the unanswered question's clock running", () => {
    const asked = beginNextTopic(runWholeCallExceptLast(ledgerOf(3)), START, "ask-3");

    const result = resolveCloseRequest(asked.ledger, START, "close-1");

    expect(result.ledger.answerDueAt).toBe(asked.ledger.answerDueAt);
    expect(result.ledger.phase).not.toBe("finished");
  });

  /**
   * `answerStartedAt` is the discriminator, exactly as in `beginNextTopic`.
   * They DID answer and the interviewer is closing ahead of the evaluator —
   * the ordinary order, three to five seconds of OpenAI round-trip behind the
   * conversation. Refusing here would deadlock the close on our own latency.
   */
  it("allows the close once they have answered, even before the verdict lands", () => {
    const asked = beginNextTopic(runWholeCallExceptLast(ledgerOf(3)), START, "ask-3");
    const answering = applyAnswerStarted(asked.ledger, START, "speech-1").ledger;

    const result = resolveCloseRequest(answering, START, "close-1");

    expect(result.allowed).toBe(true);
    expect(result.ledger.phase).toBe("finished");
  });

  /**
   * Every topic reaching a terminal status is what makes the call closable at
   * all — the guard reads statuses, not a counter, so a topic left
   * `in_progress` would keep it open just as a `pending` one would.
   */
  it("leaves no topic in a non-terminal state after a whole call", () => {
    const done = runWholeCall(ledgerOf(5));

    expect(done.topics.every((t) => t.status === "complete" || t.status === "insufficient")).toBe(true);
    expect(earliestPendingTopic(done)).toBeNull();
    expect(currentDirective(done).task).toBe("close");
  });
});

describe("applyEvaluatorFailure", () => {
  /**
   * The evaluator being unreachable says nothing about what the candidate said,
   * and this record is read by a person later — so the fallback settles the
   * topic as complete rather than writing our outage onto their file. The same
   * bias the proctoring rules take: miss something rather than accuse someone.
   */
  it("settles the open topic as complete and moves on", () => {
    const opened = beginNextTopic(ledgerOf(3), START).ledger;
    const { ledger, directive } = applyEvaluatorFailure(opened, START, "fail-1");

    expect(ledger.topics[0]?.status).toBe("complete");
    expect(ledger.topics[0]?.evidenceSummary).toMatch(/not evaluated/i);
    expect(ledger.evaluatorFailures).toBe(1);
    expect(directive.topicNumber).toBe(2);
  });

  /**
   * A permanently broken evaluator must still produce a usable call, because
   * guaranteed coverage is the thing this feature is for. Every topic asked
   * once, no follow-ups, a clean close.
   */
  it("still covers every topic when it fails on every single turn", () => {
    let ledger = ledgerOf(4);
    for (let i = 0; i < 4; i++) {
      ledger = beginNextTopic(ledger, START, `ask-${i}`).ledger;
      ledger = applyEvaluatorFailure(ledger, START, `fail-${i}`).ledger;
    }

    expect(remainingUnasked(ledger)).toBe(0);
    expect(ledger.topics.every((t) => t.askedAt === START)).toBe(true);
    expect(resolveCloseRequest(ledger, START, "close").allowed).toBe(true);
  });
});

describe("the per-answer clock", () => {
  const ASKED = "2026-08-24T10:00:10.000Z";
  const SPOKE = "2026-08-24T10:00:25.000Z";

  /**
   * ONE clock per question, and it only ever counts down.
   *
   * The budget used to restart at the candidate's first word, which made the
   * counter JUMP UP on screen — a timer running backwards, which reads as
   * broken however generous the extra minute is. It was reported as a bug by
   * the first person to watch a real call. The onset is still recorded, because
   * "how long they took to start" is useful on the transcript; it just no
   * longer moves the deadline.
   */
  it("arms one clock when the question is asked and never restarts it", () => {
    const asked = beginNextTopic(ledgerOf(3), ASKED, "ask-1").ledger;

    expect(asked.answerStartedAt).toBeNull();
    // A full minute from the QUESTION.
    expect(Date.parse(asked.answerDueAt!) - Date.parse(ASKED)).toBe(60_000);

    const speaking = applyAnswerStarted(asked, SPOKE, "speech-1").ledger;

    // The onset is recorded...
    expect(speaking.answerStartedAt).toBe(SPOKE);
    // ...and the deadline is untouched, so the counter cannot go up.
    expect(speaking.answerDueAt).toBe(asked.answerDueAt);
  });

  /**
   * Only the first onset counts. Speech state flips every time somebody pauses
   * for breath, so a clock that restarted on each one would be no clock at all
   * — a candidate could talk indefinitely in sixty-second instalments.
   */
  it("does not hand out a fresh minute when a candidate pauses and resumes", () => {
    const asked = beginNextTopic(ledgerOf(3), ASKED, "ask-1").ledger;
    const first = applyAnswerStarted(asked, SPOKE, "speech-1").ledger;
    const resumed = applyAnswerStarted(first, "2026-08-24T10:00:50.000Z", "speech-2").ledger;

    expect(resumed.answerStartedAt).toBe(SPOKE);
    expect(resumed.answerDueAt).toBe(first.answerDueAt);
  });

  /**
   * The hole the speech-triggered clock opens: a candidate who says nothing
   * never starts it. Without a second deadline the topic stays open, the close
   * guard keeps refusing, and the call cannot end at all.
   */
  it("still moves on from a candidate who never speaks", () => {
    const asked = beginNextTopic(ledgerOf(3), ASKED, "ask-1").ledger;

    expect(asked.answerDueAt).not.toBeNull();

    const movedOn = applyAnswerTimeout(asked, "2026-08-24T10:01:10.000Z", "timeout-1");

    expect(movedOn.ledger.topics[0]!.status).toBe("insufficient");
    expect(movedOn.directive.topicNumber).toBe(2);
  });

  /**
   * Speech before anything has been raised — talking over the greeting, or
   * after the goodbye — must not start a clock on a topic that does not exist.
   */
  it("ignores speech when no topic is open", () => {
    const fresh = ledgerOf(3);
    const started = applyAnswerStarted(fresh, SPOKE, "speech-1").ledger;

    expect(started.answerStartedAt).toBeNull();
    expect(started.answerDueAt).toBeNull();
  });

  /**
   * The next topic is a new question, so it gets a new clock — including a new
   * chance to start it by speaking. Carrying the previous answer's started flag
   * over would leave it running on a deadline set a minute ago and time it out
   * the instant it was asked.
   */
  it("resets the clock for the next question", () => {
    const asked = beginNextTopic(ledgerOf(3), ASKED, "ask-1").ledger;
    const speaking = applyAnswerStarted(asked, SPOKE, "speech-1").ledger;
    const settled = decideNextInterviewAction(speaking, decision(), SPOKE, "turn-1").ledger;

    const next = beginNextTopic(settled, "2026-08-24T10:00:55.000Z", "ask-2");

    expect(next.directive.task).toBe("ask_primary_question");
    expect(next.ledger.answerStartedAt).toBeNull();
    expect(Date.parse(next.ledger.answerDueAt!)).toBeGreaterThan(
      Date.parse("2026-08-24T10:00:55.000Z"),
    );
  });

  /** Settling a topic leaves nothing outstanding, so nothing should be timed. */
  it("stops the clock once a topic is settled", () => {
    const asked = beginNextTopic(ledgerOf(3), ASKED, "ask-1").ledger;
    const speaking = applyAnswerStarted(asked, SPOKE, "speech-1").ledger;
    const settled = decideNextInterviewAction(speaking, decision(), SPOKE, "turn-1");

    expect(settled.ledger.answerDueAt).toBeNull();
    expect(settled.ledger.answerStartedAt).toBeNull();
  });
});

describe("the directive while a question is still open", () => {
  /**
   * **`await_answer` is the whole instruction now** (decision 2026-08-27).
   *
   * There used to be one task value for "a topic is open" — `ask_follow_up` —
   * which the interviewer read as an instruction to probe. Right after a
   * question was asked, before the candidate had drawn breath, the control
   * block rendered it as "Follow-up probes left on this topic: 2": an
   * interviewer being told to probe somebody who had not answered yet. A
   * separate `awaitingAnswer` boolean was added to tell the two apart.
   *
   * With follow-ups gone there is only one thing an open topic can mean, so the
   * task says it and the boolean is unnecessary.
   */
  it("tells the interviewer to wait while a question is hanging", () => {
    const ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;

    expect(currentDirective(ledger).task).toBe("await_answer");
  });

  it("keeps saying so once the candidate has begun answering", () => {
    const ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;

    const { directive } = applyAnswerStarted(ledger, START, "s1");

    expect(directive.task).toBe("await_answer");
  });

  /** A directive that hands over a question is never a wait. */
  it("hands over the question instead when one is due", () => {
    const raised = beginNextTopic(ledgerOf(3), START, "a1");

    expect(raised.directive.task).toBe("ask_primary_question");
  });

  /**
   * The routine order on every hand-off: the next topic is raised, and the
   * previous topic's verdict lands a few seconds later and may only annotate.
   * That response carries the directive the interviewer is steered by, so it is
   * the one most likely to arrive over an unanswered question.
   */
  it("still says wait on a late reading that lands over the new question", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger;

    const { directive } = decideNextInterviewAction(
      ledger,
      decision({ evidenceSummary: "Named Kafka and gave figures." }),
      START,
      "late-1",
      "q1",
    );

    expect(directive.task).toBe("await_answer");
  });

  it("says the call is over once every topic is done", () => {
    const ledger = runWholeCall(ledgerOf(2));

    expect(currentDirective(ledger).task).toBe("close");
  });
});

describe("a verdict that arrives after the tool moved the call on", () => {
  /**
   * `beginNextTopic` settles the open topic `complete` the moment the tool
   * arrives with an answer behind it, because the alternative — reading the
   * ordinary order as a duplicate — swallowed the next topic entirely. It has
   * to guess, and it guesses in the candidate's favour.
   *
   * The verdict then lands a few seconds later and knows better. Leaving the
   * guess in place records a thin answer as `complete`, which is a lie in a
   * record a person reads.
   */
  it("corrects a guessed complete when the reading says the answer was thin", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    // The interviewer moves on before the evaluator reports.
    ledger = beginNextTopic(ledger, START, "a2").ledger;
    expect(ledger.topics[0]?.status).toBe("complete");

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({
        topicStatus: "insufficient",
        evidenceSummary: "Said they follow best practices; no example.",
      }),
      START,
      "late-1",
      "q1",
    );

    expect(after.topics[0]?.status).toBe("insufficient");
    expect(after.topics[0]?.evidenceSummary).toMatch(/best practices/);
  });

  it("leaves a guessed complete alone when the reading agrees with it", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ topicStatus: "complete" }),
      START,
      "late-1",
      "q1",
    );

    expect(after.topics[0]?.status).toBe("complete");
  });

  /**
   * Our outage must never land on the candidate's file. `applyEvaluatorFailure`
   * settles `complete` and says why in the summary; a reading that turns up
   * afterwards does not get to downgrade a topic on evidence nobody read.
   */
  it("never downgrades a topic that was settled with the flow", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyEvaluatorFailure(ledger, START, "fail-1").ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ topicStatus: "insufficient", evidenceSummary: "Vague." }),
      START,
      "late-1",
      "q1",
    );

    expect(after.topics[0]?.status).toBe("complete");
  });
});

describe("a topic the worker stamped that the interviewer never raised", () => {
  /**
   * The worker stamps a topic when an interviewer turn ends on a question with
   * a primary question outstanding, because the model ignores `next_topic` and
   * without the stamp no answer ever gets a deadline. It cannot see WHAT was
   * asked, and the interviewer's own prompt tells it to probe after every
   * answer — so the turn it stamps is routinely a follow-up on the topic that
   * was just settled, not the next topic at all.
   *
   * A stamp made in error is the one thing this module treats as
   * unrecoverable: that topic is spent, nothing will ever put its question to
   * the candidate, and the rubric dimension behind it scores 0. So the stamp is
   * optimistic and the evaluator is allowed to take it back — the same division
   * of labour as everywhere else here, where the worker acts on what it can
   * observe and the reading corrects it.
   */
  it("is handed back to pending when the reading says a settled topic was addressed", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    ledger = decideNextInterviewAction(ledger, decision(), START, "t1").ledger;
    // The interviewer probes topic 1 again; the worker reads the question as a
    // new topic and stamps topic 2.
    ledger = beginNextTopic(ledger, START, "stamp-1", { stamped: true }).ledger;
    expect(ledger.topics[1]?.status).toBe("in_progress");

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ addressedTopicNumber: 1, evidenceSummary: "Named the queue." }),
      START,
      "t2",
    );

    expect(after.topics[1]?.status).toBe("pending");
    expect(after.topics[1]?.askedAt).toBeNull();
    expect(after.currentTopicId).toBeNull();
  });

  it("never takes back a topic the interviewer asked for through the tool", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    ledger = decideNextInterviewAction(ledger, decision(), START, "t1").ledger;
    ledger = beginNextTopic(ledger, START, "a2").ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ addressedTopicNumber: 1, evidenceSummary: "Named the queue." }),
      START,
      "t2",
    );

    expect(after.topics[1]?.status).not.toBe("pending");
  });

  /**
   * The bound is on the LOOP, not on the topic, and getting that wrong shipped
   * a topic burn.
   *
   * It was one rollback per topic at first, on the reasoning that a candidate
   * whose answer wanders back to an earlier topic looks exactly like an
   * interviewer probing one, so taking a topic back forever would loop the call
   * on it. That priced the trade backwards. Two long improvised probes in a row
   * — the interviewer's turn running past the evaluator's round-trip twice —
   * spent the allowance and burned the next topic outright: marked `complete`,
   * never asked, no evidence, and a record that says it was.
   *
   * A stall is the better failure and this module says so everywhere else. The
   * topic stays `pending`, the close guard will not end the call, the control
   * block keeps handing it to the interviewer, and whatever was said is still
   * in the transcript the scorer reads. A burn is silent and final.
   */
  it("keeps taking a topic back for as long as the reading says it was not asked", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    ledger = decideNextInterviewAction(ledger, decision(), START, "t1").ledger;

    ledger = beginNextTopic(ledger, START, "stamp-1", { stamped: true }).ledger;
    ledger = decideNextInterviewAction(
      ledger,
      decision({ addressedTopicNumber: 1 }),
      START,
      "t2",
    ).ledger;
    expect(ledger.topics[1]?.status).toBe("pending");

    ledger = beginNextTopic(ledger, START, "stamp-2", { stamped: true }).ledger;
    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ addressedTopicNumber: 1 }),
      START,
      "t3",
    );

    expect(after.topics[1]?.status).toBe("pending");
  });

  /**
   * Wrap-up is where it stops, and that is what bounds the loop: the reserve
   * exists to raise whatever is left, once each, so a rollback there would
   * fight the one mechanism guaranteeing coverage. A stamp is also far likelier
   * to be genuine by then — the interviewer has been told to raise the
   * remaining topics and nothing else.
   */
  it("stops taking topics back once the call is wrapping up", () => {
    let ledger = beginNextTopic(ledgerOf(3), START, "a1").ledger;
    ledger = applyAnswerStarted(ledger, START, "s1").ledger;
    ledger = decideNextInterviewAction(ledger, decision(), START, "t1").ledger;
    ledger = enterWrapUp(ledger, START, "w1").ledger;
    ledger = beginNextTopic(ledger, START, "stamp-1", { stamped: true }).ledger;

    const { ledger: after } = decideNextInterviewAction(
      ledger,
      decision({ addressedTopicNumber: 1 }),
      START,
      "t2",
    );

    expect(after.topics[1]?.status).not.toBe("pending");
  });

  /**
   * The stamp is still what gets the clock right on the call it exists for —
   * one where the tool is never called at all. Nothing here may make it
   * reluctant to fire; only the reading takes it back.
   */
  it("still opens the topic and arms its clock in the first place", () => {
    const { ledger, directive } = beginNextTopic(ledgerOf(3), START, "stamp-1", {
      stamped: true,
    });

    expect(ledger.topics[0]?.status).toBe("in_progress");
    expect(ledger.answerDueAt).not.toBeNull();
    expect(directive.task).toBe("ask_primary_question");
  });
});

// ─── An answer we heard and could not save ──────────────────────────────────

describe("applyAnswerUnheard", () => {
  /**
   * The count is the whole point: without it a 0 caused by our transcription
   * failing is indistinguishable from a 0 the candidate earned.
   */
  it("counts one lost answer", () => {
    const ledger = ledgerOf(3);

    const { ledger: after } = applyAnswerUnheard(ledger, START, "e1");

    expect(after.unheardAnswers).toBe(1);
  });

  it("accumulates across a call", () => {
    let ledger = ledgerOf(3);

    ledger = applyAnswerUnheard(ledger, START, "e1").ledger;
    ledger = applyAnswerUnheard(ledger, START, "e2").ledger;

    expect(ledger.unheardAnswers).toBe(2);
  });

  /**
   * The worker retries a control post on a timeout, and the same lost answer
   * arriving twice must not read as two.
   */
  it("is idempotent on the event id", () => {
    let ledger = ledgerOf(3);

    ledger = applyAnswerUnheard(ledger, START, "same").ledger;
    ledger = applyAnswerUnheard(ledger, START, "same").ledger;

    expect(ledger.unheardAnswers).toBe(1);
  });

  /**
   * **It is a diagnostic, not a verdict.** Settling or re-opening a topic here
   * would write our own outage onto the candidate's coverage record — the same
   * rule `applyEvaluatorFailure` follows when it refuses to mark a topic
   * `insufficient` for a failure that was ours.
   */
  it("settles no topic and moves the call on in no way", () => {
    const opened = beginNextTopic(ledgerOf(3), START, "open").ledger;

    const { ledger: after, directive } = applyAnswerUnheard(opened, START, "e1");

    expect(after.topics.map((t) => t.status)).toEqual(opened.topics.map((t) => t.status));
    expect(after.currentTopicId).toBe(opened.currentTopicId);
    expect(directive).toEqual(currentDirective(opened));
  });

  /** Their minute is theirs. A report about our failure must not shorten it. */
  it("leaves the answer clock exactly where it was", () => {
    const opened = beginNextTopic(ledgerOf(3), START, "open").ledger;

    const { ledger: after } = applyAnswerUnheard(opened, START, "e1");

    expect(after.answerDueAt).toBe(opened.answerDueAt);
    expect(after.answerStartedAt).toBe(opened.answerStartedAt);
  });

  /** A ledger written before this existed reads as zero, not as undefined+1. */
  it("counts from zero on a ledger that predates the field", () => {
    const legacy = { ...ledgerOf(3), unheardAnswers: undefined };

    const { ledger: after } = applyAnswerUnheard(legacy, START, "e1");

    expect(after.unheardAnswers).toBe(1);
  });
});
