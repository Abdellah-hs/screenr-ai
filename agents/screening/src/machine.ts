/**
 * The screening interview as one explicit finite state machine.
 *
 * **Every asynchronous source becomes an event; one reducer owns every
 * transition; nothing else may change state.** The worker used to hold this in
 * a dozen loose booleans, each written from whichever LiveKit callback happened
 * to observe the thing it described — so "the state" was whatever combination a
 * given interleaving produced, and every bug in this worker's history was a
 * combination nobody had enumerated. Those combinations are now either in the
 * transition table below or unreachable.
 *
 * The division of labour is the point:
 *
 *   the app is the brain — it decides which question comes next
 *   the worker is the mouth and ears — it says it, and times the answer
 *
 * This file is the worker's half with the room taken out: pure, synchronous,
 * and with no idea LiveKit exists, so the interesting sequences are tested as
 * data rather than reasoned about against a live call.
 */

/**
 * Where the call is.
 *
 * The two terminal states are genuinely terminal. There is deliberately no
 * "degraded" or "improvising" state: an interviewer inventing its own questions
 * holds a full-length conversation that evidences no rubric dimension and
 * scores every one of them 0. A visible failure beats that.
 */
export type InterviewPhase =
  | "IDLE"
  | "GREETING"
  | "ASKING"
  | "LISTENING"
  | "FINISHING"
  | "DONE"
  | "FAILED";

/**
 * Who holds the floor.
 *
 * **The agent may speak only while this is `"AGENT"`.** It is the single
 * invariant that makes "the candidate is never interrupted" checkable rather
 * than hoped for.
 */
export type TurnOwner = "AGENT" | "CANDIDATE" | null;

/** The one event type every asynchronous source is converted into. */
export type InterviewEvent =
  | { type: "SESSION_CONNECTED" }
  | { type: "GREETING_SENT" }
  | { type: "GREETING_FINISHED" }
  | { type: "CANDIDATE_SPEECH_STARTED" }
  | { type: "CANDIDATE_SPEECH_STOPPED" }
  | { type: "TRANSCRIPT_READY"; text: string }
  | { type: "QUESTION_SENT" }
  | { type: "QUESTION_FINISHED" }
  | { type: "ANSWER_TIMER_EXPIRED" }
  /**
   * The app's answer to a report: the next question, the ending, or neither.
   *
   * Neither — no `nextQuestion` and no `finish` — means the question on the
   * floor has not been answered yet, and is NOT an error: keep listening.
   */
  | { type: "BACKEND_RESPONSE"; nextQuestion?: string; finish?: boolean }
  | { type: "BACKEND_ERROR"; reason?: string }
  | { type: "GOODBYE_SENT" }
  /**
   * The sign-off turn is over.
   *
   * `askedSomething` is read off the transcript by the worker at the moment
   * playout ends — the one party that can see what was actually said. It is the
   * difference between an ending and a question nobody may answer.
   */
  | { type: "GOODBYE_FINISHED"; askedSomething?: boolean }
  /** The room has been held open long enough for an answer to that question. */
  | { type: "CLOSING_WINDOW_ELAPSED" };

export type InterviewEventType = InterviewEvent["type"];

/** Everything the machine knows. There is no other conversation state anywhere. */
export interface InterviewState {
  state: InterviewPhase;
  turnOwner: TurnOwner;
  /**
   * A question that has been decided but not yet spoken.
   *
   * A non-null value in `LISTENING` means the candidate was still talking when
   * the answer came back, so the question is DEFERRED and asked the instant
   * they pause — the answer it follows was already banked.
   */
  pendingQuestion: string | null;
  /**
   * Topic 1, held from the moment the app names it until the audio check is
   * answered.
   *
   * **A separate field from `pendingQuestion`, because the two are asked on
   * different signals.** Sharing one field gave the opening question the
   * deferred trigger, which asks the first real question at the first pause in
   * the audio check — over a candidate saying "yes, one second, let me close
   * the door".
   */
  openingQuestion: string | null;
  /**
   * The app has said the rubric is covered, but the candidate still has the
   * floor, so the goodbye is waiting for them to finish.
   *
   * Once set it is never unset: a close is the app's last word, and a question
   * arriving behind it cannot reopen a call that is ending.
   */
  pendingClose: boolean;
  /**
   * Which question is on the floor. 0 is the greeting, whose reply is an audio
   * check and not an answer to anything.
   *
   * Everything queued asynchronously captures the value it was queued at and
   * drops itself if the call has moved on, which is what stops a late
   * transcript being graded against the question that replaced it.
   */
  questionSeq: number;
  /**
   * Has the question on the floor finished being SPOKEN?
   *
   * The difference between "listening because a question was asked" and
   * "listening because the greeting ended", which decides how long the machine
   * waits and whether the candidate sees a countdown at all. Getting it wrong
   * is the worker's oldest bug: a clock armed when the question was DECIDED
   * spent thirteen seconds of a candidate's minute on the interviewer's airtime.
   */
  questionDelivered: boolean;
  /** Is the candidate producing audio right now? */
  candidateSpeaking: boolean;
  /**
   * The minute ran out on the question currently on the floor.
   *
   * **The one thing that outranks "never speak over the candidate".** Every
   * other path holds a question until they pause, which is right for an answer
   * that ended by itself and is exactly a grace period when applied to an
   * expiry — handed to the one person who had already used all their time.
   */
  budgetExpired: boolean;
  /**
   * An answer has been handed to the backend and no reply has come back. The
   * duplicate guard: a transcript settling and a budget expiring can race, and
   * without this both would post and the second answer would ask a question
   * over the first.
   */
  awaitingBackend: boolean;
  /**
   * The sign-off ended on a question, so the room is being held open for the
   * answer instead of closing on it.
   *
   * The interviewer is told not to ask anything in its goodbye and asks anyway
   * — inviting questions is how interviews end, and a negated instruction is
   * the weakest way to argue with a habit that strong. It costs more here than
   * anywhere else on the call: the browser submits when this turn ends, so the
   * question is put to somebody who is then hung up on mid-thought.
   */
  awaitingClosingAnswer: boolean;
  /**
   * That wait has already run out once while the candidate was still talking.
   *
   * Bounds the hold at two windows. A candidate answering must not be cut off;
   * a candidate who never pauses must not be able to keep a finished call open,
   * because they give up on a frozen-looking screen, close the tab, and nothing
   * submits.
   */
  closingGraceSpent: boolean;
  /** Why the call failed, for the log and the technical message. */
  failure: string | null;
}

export function initialState(): InterviewState {
  return {
    state: "IDLE",
    turnOwner: null,
    pendingQuestion: null,
    openingQuestion: null,
    pendingClose: false,
    questionSeq: 0,
    questionDelivered: false,
    candidateSpeaking: false,
    budgetExpired: false,
    awaitingBackend: false,
    awaitingClosingAnswer: false,
    closingGraceSpent: false,
    failure: null,
  };
}

/** Where a transition line goes. Injectable so tests are not noisy. */
export type TransitionLog = (line: string) => void;

const defaultTransitionLog: TransitionLog = (line) => console.info(line);

// ─── The reducer ────────────────────────────────────────────────────────────

/**
 * The whole transition table. **Pure**: no clock beyond the log stamp, no I/O,
 * no timers, no promises.
 *
 * Returning the state object UNCHANGED is how an event is ignored, and callers
 * rely on the identity: the runner skips the side-effect pass when nothing
 * moved, so an ignored event cannot make anything happen by accident.
 */
export function reducer(
  state: InterviewState,
  event: InterviewEvent,
  log: TransitionLog = defaultTransitionLog,
): InterviewState {
  const next = transition(state, event);
  if (next === state) return state;
  // One line per transition, because a call is read as a sequence.
  log(
    `[fsm] ${new Date().toISOString()} ${state.state} --${event.type}--> ${next.state} ` +
      `turnOwner=${next.turnOwner ?? "none"}` +
      (next.questionSeq !== state.questionSeq ? ` q=${next.questionSeq}` : ""),
  );
  return next;
}

/**
 * Enter `ASKING` with a question on the floor.
 *
 * The single door into `ASKING`, which is what makes "no question is asked
 * twice" structural: the sequence number moves here and nowhere else.
 */
function beginAsking(state: InterviewState, question: string): InterviewState {
  return {
    ...state,
    state: "ASKING",
    turnOwner: "AGENT",
    pendingQuestion: question,
    questionSeq: state.questionSeq + 1,
    // A fresh question has not been heard yet and has its own whole minute.
    questionDelivered: false,
    budgetExpired: false,
    awaitingBackend: false,
  };
}

/**
 * Enter `FINISHING`: the rubric is covered and the only thing left is to say
 * goodbye. The single door into the ending, so its two routes — the directive
 * arriving in silence, and a held close being released — cannot differ.
 */
function beginFinishing(state: InterviewState): InterviewState {
  return {
    ...state,
    state: "FINISHING",
    turnOwner: "AGENT",
    pendingQuestion: null,
    openingQuestion: null,
    pendingClose: false,
    awaitingBackend: false,
  };
}

/**
 * Enter `LISTENING`, handing the floor to the candidate.
 *
 * `openingQuestion` deliberately survives this: leaving the greeting it holds
 * topic 1, asked once the audio check has settled. `pendingQuestion` does not —
 * a question decided for a turn that is now over belongs to nothing.
 */
function beginListening(
  state: InterviewState,
  patch: Partial<InterviewState> = {},
): InterviewState {
  return {
    ...state,
    state: "LISTENING",
    turnOwner: "CANDIDATE",
    pendingQuestion: null,
    ...patch,
  };
}

/**
 * Ask the question that has been waiting since the session opened.
 *
 * Cleared in the same step it is spent, so nothing can ask it twice — and if
 * the candidate is somehow still talking it falls back to the ordinary "ask at
 * the next pause" rule rather than going over the top of them.
 */
function askOpening(state: InterviewState): InterviewState {
  const question = state.openingQuestion;
  if (!question) return state;
  const spent = { ...state, openingQuestion: null };
  return spent.candidateSpeaking
    ? { ...spent, pendingQuestion: question }
    : beginAsking(spent, question);
}

/**
 * Close the room. The single door into `DONE`, because four things now reach it
 * — a delivered goodbye, a redelivered one, an answered closing question, and a
 * window running out — and they must leave the same state behind.
 */
function beginDone(state: InterviewState): InterviewState {
  return {
    ...state,
    state: "DONE",
    turnOwner: null,
    candidateSpeaking: false,
    awaitingClosingAnswer: false,
  };
}

function fail(state: InterviewState, reason: string): InterviewState {
  return {
    ...state,
    state: "FAILED",
    // The agent keeps the floor: the only thing left is one sentence and a
    // closed room.
    turnOwner: "AGENT",
    pendingQuestion: null,
    awaitingBackend: false,
    failure: reason,
  };
}

function transition(state: InterviewState, event: InterviewEvent): InterviewState {
  if (state.state === "DONE") return state;

  if (state.state === "FAILED") {
    // **The one carve-out, and it is the difference between a bad call and an
    // abandoned candidate.** `FAILED` still owes the person a sentence and a
    // closed room: without this the call sits open until the half-hour
    // backstop, the browser is never told to submit, and the expiry sweep
    // rejects them for an interview they actually sat.
    if (event.type === "GOODBYE_FINISHED") {
      return { ...state, state: "DONE", turnOwner: null };
    }
    return state;
  }

  // The backend could not answer, so there is no next question. Improvising one
  // is forbidden, so the call fails cleanly and is closed with a short
  // technical message.
  if (event.type === "BACKEND_ERROR") {
    return fail(state, event.reason ?? "the app could not be reached");
  }

  switch (state.state) {
    case "IDLE":
      if (event.type === "SESSION_CONNECTED") {
        return { ...state, state: "GREETING", turnOwner: "AGENT" };
      }
      return state;

    // The greeting asks the audio check and NOTHING else, then stops. It used
    // to greet and ask topic 1 in one turn, which produced exactly what those
    // words invite — a hello, then silence — while the ledger recorded topic 1
    // as asked and started its minute on it.
    case "GREETING":
      switch (event.type) {
        case "GREETING_FINISHED":
          // `questionSeq` stays 0: what comes back is the reply to the audio
          // check, not an answer to a question.
          return beginListening(state);

        case "CANDIDATE_SPEECH_STARTED":
          // **Talking over the greeting does not take the floor.** With
          // barge-in off the greeting plays to its end, so handing over here
          // would have the machine believe it is listening while the
          // interviewer is still talking. Recorded, and nothing else.
          return { ...state, candidateSpeaking: true };

        case "CANDIDATE_SPEECH_STOPPED":
          return { ...state, candidateSpeaking: false };

        case "BACKEND_RESPONSE":
          // The `session_started` reply, which routinely lands while the
          // greeting is still playing. It names topic 1 — held, not asked.
          return event.nextQuestion ? { ...state, openingQuestion: event.nextQuestion } : state;

        default:
          return state;
      }

    case "ASKING":
      switch (event.type) {
        case "QUESTION_FINISHED":
          // **The only honest moment to start a clock on the candidate.** The
          // question has now been heard in full — not decided, not generated,
          // heard.
          return beginListening(state, { questionDelivered: true });

        case "CANDIDATE_SPEECH_STARTED":
          // **The single most important line for a candidate's score.** A cough,
          // a backchannel, or somebody else in the room used to take the floor
          // here — which cancelled the question, and then let whatever they had
          // said be assembled and reported as their ANSWER to a topic already
          // stamped asked. One "mm-hmm" could spend a rubric dimension.
          //
          // The floor stays with the agent until the question has actually
          // finished playing. Anything said over it still reaches the transcript
          // the scorer reads; it simply cannot end the question or become the
          // answer to it.
          return { ...state, candidateSpeaking: true };

        case "CANDIDATE_SPEECH_STOPPED":
          return { ...state, candidateSpeaking: false };

        default:
          // Nothing else may move a call that is mid-question. In particular a
          // stray backend response cannot queue a second question here.
          return state;
      }

    case "LISTENING":
      switch (event.type) {
        case "CANDIDATE_SPEECH_STARTED":
          return { ...state, turnOwner: "CANDIDATE", candidateSpeaking: true };

        case "CANDIDATE_SPEECH_STOPPED": {
          const quiet = { ...state, candidateSpeaking: false };
          // Checked FIRST: a close is the app's last word, so a question that
          // arrived behind it must not be asked past the call's own ending.
          if (quiet.pendingClose) return beginFinishing(quiet);
          // A question decided while they were still talking has been waiting
          // for this.
          return quiet.pendingQuestion ? beginAsking(quiet, quiet.pendingQuestion) : quiet;
        }

        case "TRANSCRIPT_READY":
          // Ignored while a reply is already outstanding: the settle window and
          // the budget can both decide the answer is over, and two backend
          // calls for one answer would come back as two questions.
          if (state.awaitingBackend) return state;
          // **The reply to the audio check is not an answer to anything**, and
          // evaluating it would put the evaluator's round-trip between "yes, I
          // can hear you" and the first question. The app already named topic 1
          // when the session opened, and the machine has been holding it.
          if (state.questionSeq === 0 && state.openingQuestion) return askOpening(state);
          return { ...state, awaitingBackend: true };

        case "ANSWER_TIMER_EXPIRED":
          // **The minute is the minute.** Zero moves the call on, whoever is
          // talking; `budgetExpired` is what carries that through the
          // round-trip, so the politeness rule below cannot quietly reinstate
          // the grace period. Only ever set for a real budget — the same timer
          // doubles as the silence watchdog, and running out of patience is not
          // running out of time.
          // **Returned UNCHANGED, and the identity is the guard.** A report is
          // already in flight for this answer; the runner skips the side-effect
          // pass when nothing moved, and that pass is what posts. Recording
          // `budgetExpired` here instead would be a state CHANGE, so the side
          // effect would run and post a second report for one answer — which
          // comes back as a second question, asked over the first.
          //
          // What is given up is small and bounded: a question that arrives
          // while they are still talking is held politely for up to
          // `SPEAK_HOLD_MS` even though their minute has run out.
          if (state.awaitingBackend) return state;
          // Nobody answered the audio check, and topic 1 has been held since
          // the session opened, so there is nothing to ask the app about.
          if (state.questionSeq === 0 && state.openingQuestion) return askOpening(state);
          return { ...state, awaitingBackend: true, budgetExpired: state.questionDelivered };

        case "BACKEND_RESPONSE": {
          const answered = { ...state, awaitingBackend: false };
          if (event.finish || answered.pendingClose) {
            // **The goodbye waits for a pause, exactly like a question does.**
            // Cutting somebody off to say goodbye is worse than cutting them
            // off to ask something, because the browser submits on the close:
            // whatever they were saying reaches no transcript at all.
            //
            // **`budgetExpired` deliberately does NOT override this**, the one
            // place it does not. It exists so running out of time cannot delay
            // the next QUESTION; here there is no next question, so nothing is
            // delayed but the ending of a call that is already over.
            if (answered.candidateSpeaking) {
              return { ...answered, pendingClose: true, pendingQuestion: null };
            }
            return beginFinishing(answered);
          }
          // The app says the question on the floor has not been answered yet.
          if (!event.nextQuestion) return answered;
          // **The guard the whole design turns on:** the agent takes the floor
          // in the same step as the answer that grants it, and only if the
          // candidate is not using it. The exception is an expired budget,
          // which outranks the politeness.
          if (answered.candidateSpeaking && !answered.budgetExpired) {
            return { ...answered, pendingQuestion: event.nextQuestion };
          }
          return beginAsking(answered, event.nextQuestion);
        }

        case "QUESTION_FINISHED":
          // A duplicate notice: the same turn ending is observed twice, once
          // from the session's state change and once from the reply resolving,
          // and either may be first. The question itself was delivered in
          // `ASKING`, which is the only way out of it now that a question
          // cannot be cut short.
          return state;

        default:
          return state;
      }

    // **No question can be asked from here.** There is deliberately no edge out
    // of `FINISHING` except to `DONE`: a backend response arriving late cannot
    // reopen a call the candidate has already been said goodbye to.
    case "FINISHING":
      switch (event.type) {
        case "CANDIDATE_SPEECH_STARTED":
          // Recorded, and nothing else — the agent owns `FINISHING` to its end.
          //
          // This used to set `goodbyeInterrupted`, which said the sign-off had
          // been CANCELLED and owed the candidate a second one. With barge-in
          // off it cannot be cancelled, so the flag could only ever be a false
          // positive — and "thanks, bye!" over the sign-off is the most natural
          // thing a candidate says, which would have earned every one of them a
          // redundant second goodbye.
          return { ...state, candidateSpeaking: true };

        case "CANDIDATE_SPEECH_STOPPED": {
          const quiet = { ...state, candidateSpeaking: false };
          // They have answered what the sign-off asked, so nothing is owed and
          // the wait ends early. Their words are already on the transcript, and
          // the wind-down holds for the finalized item before it publishes.
          return quiet.awaitingClosingAnswer ? beginDone(quiet) : quiet;
        }

        case "GOODBYE_FINISHED":
          // **Two reasons the room may not close yet, and they are one wait.**
          //
          //  - the sign-off ended on a QUESTION, which the prompt forbids and
          //    the model does anyway — closing here asks the candidate
          //    something real and hangs up before they can answer;
          //  - the candidate is STILL TALKING, which is the ordinary end of a
          //    redelivery: they spoke over the first goodbye, were heard out,
          //    spoke over the second, and this branch used to close on top of
          //    them. The browser submits on it, so whatever they were saying
          //    reached no transcript at all.
          //
          // The second is the last place in this machine where a close did not
          // check who held the floor. Every other one waits — `pendingClose` in
          // `LISTENING`, the window below — and this one, being terminal, was
          // the most expensive to get wrong.
          if (event.askedSomething || state.candidateSpeaking) {
            return { ...state, awaitingClosingAnswer: true };
          }
          return beginDone(state);

        case "CLOSING_WINDOW_ELAPSED":
          // Nothing is being held — a stale timer from a call that already
          // closed its window.
          if (!state.awaitingClosingAnswer) return state;
          // They are mid-answer. Ending the room now is the exact failure the
          // wait exists to prevent, so it is extended — once, and never again.
          if (state.candidateSpeaking && !state.closingGraceSpent) {
            return { ...state, closingGraceSpent: true };
          }
          return beginDone(state);

        default:
          return state;
      }

    default:
      return state;
  }
}

// ─── The serialized queue ───────────────────────────────────────────────────

/**
 * What the runner hands to `applySideEffects`: the state AFTER the transition,
 * plus the event that caused it. A side effect that had to re-derive "what just
 * happened" from the state alone would be guessing, which is the class of bug
 * this machine removes.
 */
export type SideEffects = (state: InterviewState, event: InterviewEvent) => void;

export interface InterviewMachine {
  /** The current state. Read-only to everything but the runner. */
  readonly state: InterviewState;
  /**
   * Hand the machine one event. **The only way state ever changes.** Every
   * callback, timer and backend reply ends in a call to this and then returns,
   * so two of them can never interleave halfway through a transition.
   */
  enqueueEvent(event: InterviewEvent): void;
}

export function createMachine(options: {
  applySideEffects: SideEffects;
  log?: TransitionLog;
  initial?: InterviewState;
}): InterviewMachine {
  const { applySideEffects, log = defaultTransitionLog } = options;
  let state = options.initial ?? initialState();

  // The queue belongs to the runner, not to the state: a reducer that could
  // enqueue would be a reducer that could recurse.
  const queue: InterviewEvent[] = [];
  let processing = false;

  /**
   * Drain the queue, one event at a time.
   *
   * **Synchronous by construction, and that is the guarantee.** Side effects
   * start asynchronous work and return immediately; their results arrive later
   * as fresh events. Nothing is awaited inside the loop, so no event can be
   * observed half-applied and no two transitions can be in flight at once. A
   * side effect that enqueues is safe — the new event joins the queue this loop
   * is already draining.
   */
  const processQueue = () => {
    if (processing) return;
    processing = true;

    try {
      while (queue.length > 0) {
        const event = queue.shift() as InterviewEvent;
        const before = state;
        state = reducer(state, event, log);

        // An ignored event is genuinely ignored: no state moved, so nothing is
        // allowed to happen off the back of it.
        if (state === before) continue;

        try {
          applySideEffects(state, event);
        } catch (err) {
          // A throwing side effect must not abandon the queue — the events
          // behind it include the ones that end the call.
          console.error(
            `[fsm] side effect for ${event.type} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } finally {
      processing = false;
    }
  };

  return {
    get state() {
      return state;
    },
    enqueueEvent(event: InterviewEvent) {
      queue.push(event);
      processQueue();
    },
  };
}
