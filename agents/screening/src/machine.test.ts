import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createMachine,
  initialState,
  reducer,
  type InterviewEvent,
  type InterviewState,
} from "./machine.js";

const WORKER_SOURCE = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

/**
 * The worker with its comments taken out.
 *
 * The "this no longer exists" assertions below have to read CODE. This file
 * deliberately keeps long comments naming every mechanism the refactor removed
 * — that is how the next person learns why `windingDown` and the improvisation
 * fallback are not coming back — and matching raw source would make writing
 * that explanation fail the test that protects it.
 */
const WORKER_CODE = WORKER_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Silent, so a failing test shows its assertion rather than a call log. */
const quiet = () => {};

function run(state: InterviewState, ...events: InterviewEvent[]): InterviewState {
  return events.reduce((acc, event) => reducer(acc, event, quiet), state);
}

/** The state a healthy call is in once the greeting has been answered. */
function listeningAfterGreeting(): InterviewState {
  return run(
    initialState(),
    { type: "SESSION_CONNECTED" },
    { type: "BACKEND_RESPONSE", nextQuestion: "Tell me about a system you scaled." },
    { type: "GREETING_FINISHED" },
  );
}

/** The state a healthy call is in with question `n` asked and answered-for. */
function listeningOnAQuestion(): InterviewState {
  return run(
    listeningAfterGreeting(),
    { type: "TRANSCRIPT_READY", text: "Yes, I can hear you." },
    { type: "QUESTION_FINISHED" },
  );
}

// ─── The shape of a whole call ──────────────────────────────────────────────

describe("a healthy interview", () => {
  it("greets, asks, listens, and ends on a goodbye", () => {
    const greeting = run(initialState(), { type: "SESSION_CONNECTED" });
    expect(greeting.state).toBe("GREETING");
    expect(greeting.turnOwner).toBe("AGENT");

    const listening = listeningAfterGreeting();
    expect(listening.state).toBe("LISTENING");
    expect(listening.turnOwner).toBe("CANDIDATE");
    // Nothing has been ASKED yet, so no minute is owed.
    expect(listening.questionSeq).toBe(0);
    expect(listening.questionDelivered).toBe(false);

    const asking = run(listening, { type: "TRANSCRIPT_READY", text: "Yes, loud and clear." });
    expect(asking.state).toBe("ASKING");
    expect(asking.turnOwner).toBe("AGENT");
    expect(asking.questionSeq).toBe(1);
    expect(asking.pendingQuestion).toBe("Tell me about a system you scaled.");

    const answering = run(asking, { type: "QUESTION_FINISHED" });
    expect(answering.state).toBe("LISTENING");
    expect(answering.questionDelivered).toBe(true);

    const closing = run(
      answering,
      { type: "TRANSCRIPT_READY", text: "We moved it onto Kafka." },
      { type: "BACKEND_RESPONSE", finish: true },
    );
    expect(closing.state).toBe("FINISHING");
    expect(closing.turnOwner).toBe("AGENT");

    const done = run(closing, { type: "GOODBYE_FINISHED" });
    expect(done.state).toBe("DONE");
    expect(done.turnOwner).toBeNull();
  });

  /**
   * The reply to the audio check is not an answer to anything, and must not be
   * evaluated as one: `turn_completed` runs the turn evaluator, three to five
   * seconds of OpenAI round-trip, and that lands as dead air between "yes, I
   * can hear you" and the first question — the worst possible moment for the
   * call to seem broken.
   */
  it("asks topic 1 straight off the greeting reply, with no round-trip", () => {
    const asked = run(listeningAfterGreeting(), {
      type: "TRANSCRIPT_READY",
      text: "Yes, I can hear you.",
    });

    expect(asked.state).toBe("ASKING");
    // Nothing is owed by the app: the question was already in hand.
    expect(asked.awaitingBackend).toBe(false);
  });

  /**
   * **A pause is not an ending, and that holds for the audio check too.**
   *
   * Speech STOPPING is VAD's verdict on one utterance; the answer is not over
   * until the settle window has elapsed on it. A candidate who says "Yes —
   * sorry, one second, let me close the door" stops twice, and asking topic 1
   * at the first stop puts the first real question over the top of them.
   *
   * The two questions the machine can be holding therefore have different
   * triggers and must not share a field: a DEFERRED question (decided while
   * they were talking) is asked the moment they pause, because their answer
   * was already banked; the OPENING question is asked when the audio check has
   * settled.
   */
  it("does not ask topic 1 on a pause in the audio check", () => {
    const paused = run(listeningAfterGreeting(), { type: "CANDIDATE_SPEECH_STARTED" }, {
      type: "CANDIDATE_SPEECH_STOPPED",
    });

    expect(paused.state).toBe("LISTENING");
    expect(paused.questionSeq).toBe(0);
  });

  /**
   * The greeting stops after the audio check, which is the only way that check
   * can mean anything — so a candidate fighting a microphone dialog would
   * otherwise leave the room silent for good. The watchdog fires and topic 1
   * is asked anyway.
   */
  it("asks topic 1 anyway when nobody answers the audio check", () => {
    const asked = run(listeningAfterGreeting(), { type: "ANSWER_TIMER_EXPIRED" });

    expect(asked.state).toBe("ASKING");
    expect(asked.questionSeq).toBe(1);
    // A watchdog running out is not a minute running out.
    expect(asked.budgetExpired).toBe(false);
  });
});

// ─── Turn ownership ─────────────────────────────────────────────────────────

describe("turn ownership", () => {
  /**
   * The invariant the whole design exists to make checkable. Everything that
   * speaks is gated on `turnOwner === "AGENT"`, so if the candidate can hold
   * the floor while the machine is in a speaking state, the worker will talk
   * over somebody.
   */
  it("never lets the agent hold the floor while the machine is listening", () => {
    const states = [
      listeningAfterGreeting(),
      listeningOnAQuestion(),
      run(listeningOnAQuestion(), { type: "CANDIDATE_SPEECH_STARTED" }),
      run(listeningOnAQuestion(), { type: "TRANSCRIPT_READY", text: "..." }),
      run(listeningOnAQuestion(), { type: "ANSWER_TIMER_EXPIRED" }),
    ];

    for (const state of states) {
      expect(state.state).toBe("LISTENING");
      expect(state.turnOwner).toBe("CANDIDATE");
    }
  });

  /**
   * **The floor passes when the agent's turn ENDS, never when the candidate
   * starts talking.**
   *
   * It used to pass on their first word, because barge-in was on and their
   * speech genuinely cancelled the turn. With barge-in off the question plays
   * to its end, so handing over on their first word would leave the machine
   * believing it was listening while the interviewer was still mid-sentence —
   * and, far worse, would let whatever they said over the question be assembled
   * and reported as their ANSWER to it.
   */
  it("keeps the floor with the agent until its own turn ends", () => {
    const overTheGreeting = run(
      run(initialState(), { type: "SESSION_CONNECTED" }),
      { type: "CANDIDATE_SPEECH_STARTED" },
    );
    expect(`${overTheGreeting.state} owner=${overTheGreeting.turnOwner}`).toBe("GREETING owner=AGENT");

    const overAQuestion = run(
      run(listeningAfterGreeting(), { type: "TRANSCRIPT_READY", text: "Yes." }),
      { type: "CANDIDATE_SPEECH_STARTED" },
    );
    expect(`${overAQuestion.state} owner=${overAQuestion.turnOwner}`).toBe("ASKING owner=AGENT");
  });

  /**
   * **A cough must not be able to spend a topic.**
   *
   * The transcript handler assembles a candidate turn into an answer only while
   * the machine is `LISTENING`, so this transition is the whole guard: anything
   * said over a question — a backchannel, somebody else in the room, a cough —
   * stays out of the answer, and out of the `turn_completed` that would settle
   * the topic and move the call on. It still reaches the transcript the scorer
   * reads; it simply cannot be mistaken for the answer.
   */
  it("does not let speech over a question become the answer to it", () => {
    const asking = run(listeningAfterGreeting(), { type: "TRANSCRIPT_READY", text: "Yes." });
    expect(asking.state).toBe("ASKING");

    const coughed = run(
      asking,
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "CANDIDATE_SPEECH_STOPPED" },
    );

    // Still asking, still the same question, and nothing reported.
    expect(`${coughed.state} q=${coughed.questionSeq}`).toBe("ASKING q=1");
    expect(coughed.awaitingBackend).toBe(false);
  });

  /**
   * Their minute cannot start until the audio STOPS, or the interviewer's own
   * airtime comes out of it — thirteen seconds of it, on the call that produced
   * this rule.
   */
  it("starts the minute only once the question has finished playing", () => {
    const talkingOver = run(
      run(listeningAfterGreeting(), { type: "TRANSCRIPT_READY", text: "Yes." }),
      { type: "CANDIDATE_SPEECH_STARTED" },
    );
    expect(talkingOver.questionDelivered).toBe(false);

    const delivered = run(talkingOver, { type: "QUESTION_FINISHED" });
    expect(delivered.state).toBe("LISTENING");
    expect(delivered.questionDelivered).toBe(true);
  });

  /**
   * `QUESTION_FINISHED` arrives from two places — the session's own state
   * change and the reply resolving on playout — and whichever is second must
   * change nothing.
   */
  it("ignores a second notice that the same question finished", () => {
    const once = run(listeningOnAQuestion());
    const twice = reducer(once, { type: "QUESTION_FINISHED" }, quiet);

    expect(twice).toBe(once);
  });
});

// ─── The guard on asking ────────────────────────────────────────────────────

describe("nothing may ask a question but a backend answer", () => {
  const noise: InterviewEvent[] = [
    { type: "SESSION_CONNECTED" },
    { type: "GREETING_SENT" },
    { type: "GREETING_FINISHED" },
    { type: "QUESTION_SENT" },
    { type: "QUESTION_FINISHED" },
    { type: "CANDIDATE_SPEECH_STARTED" },
    { type: "CANDIDATE_SPEECH_STOPPED" },
    { type: "GOODBYE_SENT" },
    { type: "GOODBYE_FINISHED" },
  ];

  it("stays in LISTENING through every event that is not one", () => {
    for (const event of noise) {
      const after = reducer(listeningOnAQuestion(), event, quiet);
      expect(`${event.type} -> ${after.state}`).toBe(`${event.type} -> LISTENING`);
    }
  });

  /**
   * Two things can decide an answer is over — the settle window elapsing and
   * the budget running out — and they race constantly. Two backend calls for
   * one answer come back as two questions, the second of which is asked over
   * the first.
   */
  it("reports one answer once, however many things notice it ended", () => {
    const reported = run(listeningOnAQuestion(), {
      type: "TRANSCRIPT_READY",
      text: "We moved it onto Kafka.",
    });
    expect(reported.awaitingBackend).toBe(true);

    // Both of the other ways an answer can be declared over.
    const again = reducer(reported, { type: "TRANSCRIPT_READY", text: "…and it worked." }, quiet);
    expect(again).toBe(reported);
    expect(reducer(reported, { type: "ANSWER_TIMER_EXPIRED" }, quiet).awaitingBackend).toBe(true);
  });

  it("bumps the question number in exactly one place", () => {
    // The source is the assertion: two doors into ASKING could disagree about
    // which question is current, and a stale sequence is what grades an answer
    // against a question the candidate never heard.
    const machineSource = readFileSync(new URL("./machine.ts", import.meta.url), "utf8");
    expect(machineSource.match(/questionSeq: state\.questionSeq \+ 1/g)).toHaveLength(1);
  });
});

// ─── Never speaking over the candidate ──────────────────────────────────────

describe("the interviewer never starts a turn over the candidate", () => {
  it("holds the next question while they are still talking", () => {
    const stillTalking = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "TRANSCRIPT_READY", text: "So, the first thing we did…" },
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "BACKEND_RESPONSE", nextQuestion: "And how did you test it?" },
    );

    expect(stillTalking.state).toBe("LISTENING");
    expect(stillTalking.turnOwner).toBe("CANDIDATE");
    expect(stillTalking.pendingQuestion).toBe("And how did you test it?");
  });

  it("asks the held question the moment they stop", () => {
    const asked = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "TRANSCRIPT_READY", text: "So, the first thing we did…" },
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "BACKEND_RESPONSE", nextQuestion: "And how did you test it?" },
      { type: "CANDIDATE_SPEECH_STOPPED" },
    );

    expect(asked.state).toBe("ASKING");
    expect(asked.turnOwner).toBe("AGENT");
    expect(asked.pendingQuestion).toBe("And how did you test it?");
  });

  /**
   * **The minute is the minute.** Holding the next question until they pause is
   * exactly the fifteen-second grace this call deliberately no longer has — and
   * it would be handed to the one person who had already used all of their
   * time. The visible countdown is what makes moving on fair.
   */
  it("does not hold the next question back for a candidate whose minute ran out", () => {
    const movedOn = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "ANSWER_TIMER_EXPIRED" },
      { type: "BACKEND_RESPONSE", nextQuestion: "Next one." },
    );

    expect(movedOn.state).toBe("ASKING");
    expect(movedOn.candidateSpeaking).toBe(true);
  });

  /**
   * **The goodbye is speech too, and it was the one kind that did not wait.**
   *
   * Reported from a live call: "while speaking it submits." The close branch
   * went straight to `FINISHING` with no check on whether the candidate had the
   * floor, while the question branch immediately below it checked. So the
   * ordinary end of a call cut people off:
   *
   * ```
   * candidate answers the last question, pauses
   * -> turn_completed posted, evaluator runs (3-5s)
   * -> candidate resumes ("...and yeah, that's basically it")
   * -> directive `close` lands  -> FINISHING -> goodbye over the top of them
   * -> their speech cancels it  -> one redelivery -> DONE
   * -> screening.finished published, the browser submits mid-sentence
   * ```
   *
   * Whatever they were saying reaches no transcript, and from the chair it is
   * the product hanging up on you.
   */
  it("does not say goodbye over a candidate who is still talking", () => {
    const closing = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "TRANSCRIPT_READY", text: "We moved it onto Kafka." },
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "BACKEND_RESPONSE", finish: true },
    );

    expect(closing.state).toBe("LISTENING");
    expect(closing.turnOwner).toBe("CANDIDATE");
  });

  it("says goodbye the moment they stop", () => {
    const closing = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "TRANSCRIPT_READY", text: "We moved it onto Kafka." },
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "BACKEND_RESPONSE", finish: true },
      { type: "CANDIDATE_SPEECH_STOPPED" },
    );

    expect(closing.state).toBe("FINISHING");
    expect(closing.turnOwner).toBe("AGENT");
  });

  /**
   * **An expired budget does NOT override the wait at the close**, unlike at a
   * question — and the asymmetry is the whole point.
   *
   * `budgetExpired` exists so that running out of time cannot delay the NEXT
   * QUESTION, because delaying it is the grace period the visible countdown
   * promises does not exist. At the close there is no next question. Nothing is
   * being delayed except the ending of a call that is already over, and the
   * cost of not waiting is a real answer cut off and submitted mid-sentence.
   */
  it("waits for a pause before closing even when their minute ran out", () => {
    const closing = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "ANSWER_TIMER_EXPIRED" },
      { type: "BACKEND_RESPONSE", finish: true },
    );

    expect(closing.state).toBe("LISTENING");
    expect(run(closing, { type: "CANDIDATE_SPEECH_STOPPED" }).state).toBe("FINISHING");
  });

  /**
   * A close that has been decided cannot be undone by a question arriving
   * behind it — the rubric is covered, and asking anything more would be the
   * interviewer talking past its own ending.
   */
  it("cannot be talked out of a close it has already decided", () => {
    const closing = run(
      listeningOnAQuestion(),
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "BACKEND_RESPONSE", finish: true },
      { type: "BACKEND_RESPONSE", nextQuestion: "One more thing?" },
      { type: "CANDIDATE_SPEECH_STOPPED" },
    );

    expect(closing.state).toBe("FINISHING");
  });

  it("gives the next question its own whole minute", () => {
    const next = run(
      listeningOnAQuestion(),
      { type: "ANSWER_TIMER_EXPIRED" },
      { type: "BACKEND_RESPONSE", nextQuestion: "Next one." },
    );

    expect(next.budgetExpired).toBe(false);
    expect(next.questionDelivered).toBe(false);
  });
});

// ─── The app said wait ──────────────────────────────────────────────────────

describe("a directive with nothing to ask", () => {
  /**
   * The ledger reports `ask_follow_up` for ANY open topic, including the
   * seconds between a question being asked and the candidate drawing breath.
   * That is not an error and must not be confused with one.
   */
  it("keeps listening rather than failing or speaking", () => {
    const waiting = run(
      listeningOnAQuestion(),
      { type: "TRANSCRIPT_READY", text: "Hmm." },
      { type: "BACKEND_RESPONSE" },
    );

    expect(waiting.state).toBe("LISTENING");
    expect(waiting.turnOwner).toBe("CANDIDATE");
    expect(waiting.awaitingBackend).toBe(false);
    expect(waiting.pendingQuestion).toBeNull();
  });
});

// ─── Failure ────────────────────────────────────────────────────────────────

describe("a backend that cannot answer", () => {
  /**
   * **No improvisation.** The old degraded path handed the interviewer its own
   * topic guide and told it to carry on, which produces a full-length
   * conversation evidencing no rubric dimension — the candidate is scored 0
   * across the board and nobody reviewing it can tell why.
   */
  it("fails from wherever the call had got to", () => {
    const from: InterviewState[] = [
      run(initialState(), { type: "SESSION_CONNECTED" }),
      listeningAfterGreeting(),
      listeningOnAQuestion(),
      run(listeningAfterGreeting(), { type: "TRANSCRIPT_READY", text: "Yes." }),
    ];

    for (const state of from) {
      const failed = reducer(state, { type: "BACKEND_ERROR" }, quiet);
      expect(`${state.state} -> ${failed.state}`).toBe(`${state.state} -> FAILED`);
      expect(failed.pendingQuestion).toBeNull();
      expect(failed.failure).toBeTruthy();
    }
  });

  /**
   * `FAILED` still owes the person on the other end a sentence and a closed
   * room. Without the one edge out, the call sits open until the half-hour
   * backstop, their browser is never told to submit, and the expiry sweep
   * rejects them for an interview they actually sat.
   */
  it("can still be closed, and by nothing else", () => {
    const failed = reducer(listeningOnAQuestion(), { type: "BACKEND_ERROR" }, quiet);

    const ignored: InterviewEvent[] = [
      { type: "BACKEND_RESPONSE", nextQuestion: "One more thing?" },
      { type: "TRANSCRIPT_READY", text: "hello?" },
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "ANSWER_TIMER_EXPIRED" },
      { type: "QUESTION_FINISHED" },
    ];
    for (const event of ignored) {
      expect(reducer(failed, event, quiet)).toBe(failed);
    }

    expect(reducer(failed, { type: "GOODBYE_FINISHED" }, quiet).state).toBe("DONE");
  });
});

// ─── The ending ─────────────────────────────────────────────────────────────

describe("the ending", () => {
  const finishing = () =>
    run(
      listeningOnAQuestion(),
      { type: "TRANSCRIPT_READY", text: "That is about it." },
      { type: "BACKEND_RESPONSE", finish: true },
    );

  /**
   * A backend response arriving late must not reopen a call the candidate has
   * already been said goodbye to.
   */
  it("cannot be talked back into asking a question", () => {
    const late = reducer(
      finishing(),
      { type: "BACKEND_RESPONSE", nextQuestion: "One last thing?" },
      quiet,
    );

    expect(late.state).toBe("FINISHING");
    expect(late.pendingQuestion).toBeNull();
  });

  /**
   * **The sign-off is delivered in full, so there is nothing to re-say.**
   *
   * A redelivery used to live here: barge-in was on, `generateReply` resolves
   * on a CANCELLED playout exactly as on a completed one, so a candidate
   * talking over the sign-off stopped it — and the room shut 120ms later with
   * what they said reaching no transcript at all. With barge-in off the turn
   * cannot be cancelled, so "thanks, bye!" over the sign-off is just somebody
   * being polite. Reading it as an interruption would have earned every
   * courteous candidate a redundant second goodbye.
   *
   * What survives is the part that mattered: the room does not close over them.
   */
  it("does not say goodbye twice when they speak over it", () => {
    const spokenOver = run(finishing(), { type: "CANDIDATE_SPEECH_STARTED" });

    // The floor is not handed over: the only thing left to do is sign off.
    expect(spokenOver.turnOwner).toBe("AGENT");
    expect(spokenOver.state).toBe("FINISHING");

    // The sign-off finishes; they are still talking, so it is held, not re-said.
    const held = run(spokenOver, { type: "GOODBYE_FINISHED" });
    expect(`${held.state} waiting=${held.awaitingClosingAnswer}`).toBe("FINISHING waiting=true");

    expect(run(held, { type: "CANDIDATE_SPEECH_STOPPED" }).state).toBe("DONE");
  });

  /**
   * The general form of the same rule, and the last place in this machine where
   * a close did not check who held the floor. Every other one waits.
   */
  it("never closes the room while the candidate is talking", () => {
    const talking = run(finishing(), { type: "CANDIDATE_SPEECH_STARTED" });
    const spent = { ...talking, goodbyeRedelivered: true, goodbyeInterrupted: false };

    expect(run(spent, { type: "GOODBYE_FINISHED" }).state).toBe("FINISHING");
  });

  it("leaves a goodbye that was actually delivered alone", () => {
    expect(run(finishing(), { type: "GOODBYE_FINISHED" }).state).toBe("DONE");
  });

  /**
   * **The complaint this whole section grew out of**, reported from the chair:
   * "at the end it asks a follow-up and it submits."
   *
   * The model cannot start a turn (`create_response: false`), so exactly one
   * turn can speak at the end — the goodbye. Its WORDS are still the model's,
   * and closing an interview by inviting questions is one of the strongest
   * habits it has. The room closes on that turn and the browser submits when it
   * does, so the candidate is asked something real and hung up on mid-thought,
   * with their answer reaching no transcript at all.
   *
   * The prompt now forbids it positively. This is what holds when it does it
   * anyway.
   */
  describe("a sign-off that ended on a question", () => {
    const asked = () => run(finishing(), { type: "GOODBYE_FINISHED", askedSomething: true });

    it("does not close the room on the question it just asked", () => {
      expect(asked().state).toBe("FINISHING");
      expect(asked().awaitingClosingAnswer).toBe(true);
    });

    /**
     * Asserted as the whole sequence rather than the last state, because a room
     * that closed on the question and then ignored everything after it also
     * ends up at `DONE` — the bug passes any test that only reads the end.
     */
    it("closes as soon as they have answered it, and not before", () => {
      const speaking = run(asked(), { type: "CANDIDATE_SPEECH_STARTED" });
      expect(speaking.state).toBe("FINISHING");

      expect(run(speaking, { type: "CANDIDATE_SPEECH_STOPPED" }).state).toBe("DONE");
    });

    /**
     * Answering a question the sign-off asked is not an interruption — that
     * turn is over. Reading it as one would say goodbye a second time on top
     * of the answer it had just asked for.
     */
    it("keeps the room open while they answer, and hands over no floor", () => {
      const speaking = run(asked(), { type: "CANDIDATE_SPEECH_STARTED" });

      expect(`${speaking.state} owner=${speaking.turnOwner}`).toBe("FINISHING owner=AGENT");
      expect(speaking.awaitingClosingAnswer).toBe(true);
    });

    it("closes on its own when nobody answers", () => {
      const waiting = asked();
      expect(waiting.state).toBe("FINISHING");

      expect(run(waiting, { type: "CLOSING_WINDOW_ELAPSED" }).state).toBe("DONE");
    });

    /**
     * Ending the room mid-answer is the exact failure the wait exists to
     * prevent — but a candidate who never pauses must not be able to hold a
     * finished call open either: they give up on a frozen-looking screen, close
     * the tab, and nothing submits.
     */
    it("waits again for a candidate still mid-answer, but only once", () => {
      const talking = run(asked(), { type: "CANDIDATE_SPEECH_STARTED" });

      const extended = run(talking, { type: "CLOSING_WINDOW_ELAPSED" });
      expect(`${extended.state} grace=${extended.closingGraceSpent}`).toBe("FINISHING grace=true");

      expect(run(extended, { type: "CLOSING_WINDOW_ELAPSED" }).state).toBe("DONE");
    });

    /**
     * They spoke over the sign-off AND it ended on a question. One wait covers
     * both — there is no ordering left to get wrong.
     */
    it("holds once for a question asked over a candidate who is talking", () => {
      const both = run(
        finishing(),
        { type: "CANDIDATE_SPEECH_STARTED" },
        { type: "GOODBYE_FINISHED", askedSomething: true },
      );

      expect(`${both.state} waiting=${both.awaitingClosingAnswer}`).toBe("FINISHING waiting=true");
    });

    it("still closes a sign-off that ended properly", () => {
      const closed = run(finishing(), { type: "GOODBYE_FINISHED", askedSomething: false });

      expect(closed.state).toBe("DONE");
      expect(closed.awaitingClosingAnswer).toBe(false);
    });

    /** A stale timer from a window that has already been answered. */
    it("ignores the window elapsing when nothing is being held", () => {
      const state = finishing();
      expect(reducer(state, { type: "CLOSING_WINDOW_ELAPSED" }, quiet)).toBe(state);
    });
  });

  it("ignores everything once the room has closed", () => {
    const done = run(finishing(), { type: "GOODBYE_FINISHED" });
    const events: InterviewEvent[] = [
      { type: "SESSION_CONNECTED" },
      { type: "CANDIDATE_SPEECH_STARTED" },
      { type: "TRANSCRIPT_READY", text: "wait!" },
      { type: "BACKEND_RESPONSE", nextQuestion: "one more" },
      { type: "BACKEND_ERROR" },
      { type: "GOODBYE_FINISHED" },
    ];

    for (const event of events) expect(reducer(done, event, quiet)).toBe(done);
  });
});

// ─── The reducer's contract ─────────────────────────────────────────────────

/**
 * Two things can decide one answer is over — the settle window and the budget —
 * and the candidate pressing "I'm done" is now a third. Two reports for one
 * answer come back as two questions, the second asked over the first.
 */
describe("one answer, one report", () => {
  it("ignores the budget expiring while a report is already in flight", () => {
    const reported = run(listeningOnAQuestion(), { type: "TRANSCRIPT_READY", text: "Done." });
    expect(reported.awaitingBackend).toBe(true);

    // Unchanged BY IDENTITY: the runner skips side effects when nothing moved,
    // and that pass is what posts.
    expect(reducer(reported, { type: "ANSWER_TIMER_EXPIRED" }, quiet)).toBe(reported);
  });

  it("ignores a second transcript while a report is already in flight", () => {
    const reported = run(listeningOnAQuestion(), { type: "TRANSCRIPT_READY", text: "Done." });

    expect(reducer(reported, { type: "TRANSCRIPT_READY", text: "and more" }, quiet)).toBe(reported);
  });
});

describe("the reducer is pure", () => {
  /**
   * The queue belongs to the RUNNER and is not on the state at all, which is
   * stronger than a reducer that merely promises not to touch one: a reducer
   * that could enqueue would be a reducer that could recurse.
   */
  it("cannot reach the queue, because the state does not carry one", () => {
    const state = initialState();

    expect(state).not.toHaveProperty("eventQueue");
    expect(state).not.toHaveProperty("processing");
  });

  it("does not mutate the state it was given", () => {
    const state = listeningOnAQuestion();
    const snapshot = JSON.stringify(state);

    reducer(state, { type: "TRANSCRIPT_READY", text: "an answer" }, quiet);

    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("returns the same object when it ignores an event", () => {
    const state = initialState();
    expect(reducer(state, { type: "TRANSCRIPT_READY", text: "nobody asked" }, quiet)).toBe(state);
  });

  it("logs where it came from, what moved it, and who holds the floor", () => {
    const lines: string[] = [];
    reducer(initialState(), { type: "SESSION_CONNECTED" }, (line) => lines.push(line));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("IDLE --SESSION_CONNECTED--> GREETING");
    expect(lines[0]).toContain("turnOwner=AGENT");
    // A timestamp, so a call can be followed from the log without a database.
    expect(lines[0]).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("says nothing about an event it ignored", () => {
    const lines: string[] = [];
    reducer(initialState(), { type: "GOODBYE_FINISHED" }, (line) => lines.push(line));

    expect(lines).toHaveLength(0);
  });
});

// ─── The queue ──────────────────────────────────────────────────────────────

describe("the event queue", () => {
  /**
   * The property the whole refactor turns on: a side effect that enqueues —
   * which most of them do — must join the drain already running rather than
   * start a nested one. A nested drain is two transitions in flight at once,
   * which is the interleaving this design exists to remove.
   */
  it("processes events one at a time, even when side effects enqueue", () => {
    const seen: string[] = [];
    const depths: number[] = [];
    let depth = 0;

    const machine = createMachine({
      log: quiet,
      applySideEffects: (state, event) => {
        depth += 1;
        depths.push(depth);
        seen.push(`${event.type}@${state.state}`);
        if (event.type === "SESSION_CONNECTED") {
          machine.enqueueEvent({ type: "GREETING_FINISHED" });
          machine.enqueueEvent({ type: "TRANSCRIPT_READY", text: "yes" });
        }
        depth -= 1;
      },
    });

    machine.enqueueEvent({ type: "SESSION_CONNECTED" });

    expect(seen).toEqual([
      "SESSION_CONNECTED@GREETING",
      "GREETING_FINISHED@LISTENING",
      "TRANSCRIPT_READY@LISTENING",
    ]);
    // Never re-entered.
    expect(depths.every((d) => d === 1)).toBe(true);
  });

  it("is ready for the next event once it has drained", () => {
    const machine = createMachine({ log: quiet, applySideEffects: () => {} });
    machine.enqueueEvent({ type: "SESSION_CONNECTED" });

    // A second drain runs rather than being refused as re-entrant, which is
    // what a processing flag left set would do — and a machine that ignores
    // every later event is a room nobody will ever drive again.
    machine.enqueueEvent({ type: "GREETING_FINISHED" });

    expect(machine.state.state).toBe("LISTENING");
  });

  it("runs no side effect for an event the reducer ignored", () => {
    const seen: string[] = [];
    const machine = createMachine({
      log: quiet,
      applySideEffects: (_state, event) => seen.push(event.type),
    });

    machine.enqueueEvent({ type: "GOODBYE_FINISHED" });
    machine.enqueueEvent({ type: "SESSION_CONNECTED" });
    machine.enqueueEvent({ type: "GREETING_SENT" });

    expect(seen).toEqual(["SESSION_CONNECTED"]);
  });

  /**
   * The events behind a throwing side effect include the ones that end the
   * call. Abandoning the drain would leave the candidate in a room nothing
   * will ever close.
   */
  it("keeps draining when a side effect throws", () => {
    const seen: string[] = [];
    const machine = createMachine({
      log: quiet,
      applySideEffects: (_state, event) => {
        seen.push(event.type);
        if (event.type === "SESSION_CONNECTED") {
          machine.enqueueEvent({ type: "GREETING_FINISHED" });
          throw new Error("speech failed");
        }
      },
    });

    machine.enqueueEvent({ type: "SESSION_CONNECTED" });

    expect(seen).toEqual(["SESSION_CONNECTED", "GREETING_FINISHED"]);
    expect(machine.state.state).toBe("LISTENING");
    // ...and the machine still accepts events afterwards.
    machine.enqueueEvent({ type: "CANDIDATE_SPEECH_STARTED" });
    expect(machine.state.candidateSpeaking).toBe(true);
  });
});

// ─── The worker is wired to the machine and to nothing else ─────────────────

describe("the worker changes state only through the machine", () => {
  /**
   * Every LiveKit callback used to write loose booleans directly, and the
   * combinations nobody enumerated are where every bug in this worker's history
   * came from. A handler may now record what only it can see and enqueue; it
   * may not decide.
   */
  it("has no state left outside the machine", () => {
    for (const flag of [
      "windingDown",
      "awaitingGoodbye",
      "goodbyeInterrupted",
      "clockArmPending",
      "budgetExpired =",
      "agentSpeaking",
      "degraded",
    ]) {
      expect(WORKER_CODE).not.toContain(flag);
    }
  });

  /**
   * The improvisation path and the kill switch that restored it. `SCREENING_TOPIC_CONTROL=0`
   * flipped `create_response` back to true and let the model run the call from
   * its own guide — a second controller, which is the failure mode rather than
   * the fallback.
   */
  it("cannot improvise its own questions", () => {
    expect(WORKER_CODE).not.toContain("topicControlEnabled");
    expect(WORKER_CODE).not.toContain("SCREENING_TOPIC_CONTROL");
    expect(WORKER_CODE).not.toContain("topicFallback");
    expect(WORKER_CODE).not.toContain("improvise");
    // The model is never allowed to start a turn, so it can never ask a
    // question nobody chose. Asserted on the assignment rather than on the
    // absence of the words, so the prose above it stays free to explain what
    // `false` costs.
    const assignments = WORKER_CODE.match(/^\s*create_response: .+,$/gm) ?? [];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.trim()).toBe("create_response: false,");
  });

  /**
   * The interviewer's questions come from the app's route and nowhere else.
   *
   * They used to ride in LiveKit room metadata, which LiveKit delivers to EVERY
   * participant — so the candidate's own browser received the confidential topic
   * guide on join. The app stopped publishing it on 2026-08-24 and the worker
   * kept reading it as a rollout fallback; that fallback is now dead code, and
   * dead code that reads candidate-visible metadata is worth deleting rather
   * than leaving for somebody to re-enable.
   */
  it("reads its questions from the app, never from candidate-visible metadata", () => {
    expect(WORKER_CODE).not.toContain("meta.instructions");
    expect(WORKER_CODE).not.toContain("instructions?: string");
    // Metadata carries the application id and nothing else.
    expect(WORKER_CODE).toContain("interface ScreeningRoomMetadata {");
    expect(WORKER_CODE).toContain("await fetchInstructions(applicationId)");
  });

  it("lets nothing but generateReply put words in the room", () => {
    // One call site, inside the one serialized lane, so two turns cannot
    // overlap however the events arrive.
    expect(WORKER_CODE.match(/session\.generateReply\(/g)).toHaveLength(1);
  });

  it("drives the whole call from enqueued events", () => {
    // Every session handler ends in an enqueue rather than a decision.
    expect(WORKER_CODE).toContain('machine.enqueueEvent({ type: "CANDIDATE_SPEECH_STARTED" })');
    expect(WORKER_CODE).toContain('machine.enqueueEvent({ type: "CANDIDATE_SPEECH_STOPPED" })');
    expect(WORKER_CODE).toContain('machine.enqueueEvent({ type: "SESSION_CONNECTED" })');
  });
});
