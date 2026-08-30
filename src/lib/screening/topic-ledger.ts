/**
 * The voice screening's **topic ledger** — what was actually asked, and what
 * the interviewer is allowed to do next.
 *
 * Until this existed, "cover every topic" was a sentence in a prompt and
 * nothing else. The interviewer was handed a confidential numbered guide and
 * told to raise all of it; nothing observed whether it did. That mattered more
 * than a missed question usually would, because of how the stage is scored: the
 * overall is the weighted mean over EVERY rubric dimension, and a dimension
 * with no evidence scores 0. A topic the interviewer skipped therefore cost the
 * candidate exactly what refusing to answer it would have — for a decision
 * nobody made and nobody could see.
 *
 * So the ledger is the application's record of coverage, and it is authoritative:
 *
 * - The interviewer cannot raise a topic without the ledger stamping it asked.
 * - The interviewer cannot end the call while any topic is still `pending`.
 * - **One question, one answer, the next question** (decision 2026-08-27).
 *   Every answer settles its topic, however thin it was: a vague one is marked
 *   `insufficient` and left behind. There used to be a counted follow-up budget
 *   here, and removing it removed the largest source of complexity on both
 *   sides of the wire — most of which existed to observe and correct probes the
 *   model asked without being told to. The one thing worse than a thin answer
 *   is a call that spends its remaining minutes trying to improve one.
 *
 * **This module decides nothing about the candidate.** `insufficient` is a
 * statement about coverage — "we asked, and moved on" — not a score, a tier or
 * a verdict. Scoring happens afterwards in `src/lib/screening-scoring/`, which
 * reads the WHOLE transcript per rubric dimension and never sees this file.
 * Narrowing evidence to "the answer given to that topic" would recreate exactly
 * the per-question bug the 2026-08-22 decision removed: a candidate who
 * evidences a competency while answering some other question has evidenced it.
 *
 * Pure by contract, in the manner of `src/lib/rules/`: no Supabase, no OpenAI,
 * no `Date.now()`. Every function that needs the time is handed it. The model's
 * reading arrives as a `TopicTurnDecision` and is treated as evidence — the
 * rules here decide what happens to it, which is CLAUDE.md's "Control > AI >
 * Data" applied to conversation flow rather than to application state.
 */
import {
  SCREENING_ANSWER_BUDGET_MS,
  SCREENING_CALL_BACKSTOP_MINUTES,
  SCREENING_WRAP_UP_RESERVE_MS,
} from "@/lib/constants";

/**
 * Bump when the rules below change materially. Persisted with the ledger, so a
 * stored coverage record always says which arithmetic produced it — the same
 * discipline `SCREENING_SCORING_RULES_VERSION` keeps for the score.
 */
export const SCREENING_TOPIC_RULES_VERSION = "v4_correctable_stamp";

/** How many event ids are remembered for idempotency. See `handledEventIds`. */
const HANDLED_EVENT_MEMORY = 50;

export type ScreeningTopicStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "insufficient";

export type ScreeningPhase = "interviewing" | "wrapping_up" | "finished";

/**
 * What the interviewer is being told to do on its next turn.
 *
 * **Three states, and there is no fourth** (decision 2026-08-27). Follow-up
 * probes were removed: a call is now ask the question, wait for the answer,
 * ask the next one, close. `await_answer` replaced `ask_follow_up`, which had
 * become a value that never meant what it said — the ledger returned it for ANY
 * open topic, so it covered both "probe this thin answer" and "they have not
 * spoken yet", and only a separate boolean told them apart.
 */
export type ScreeningTask = "ask_primary_question" | "await_answer" | "close";

export interface ScreeningTopic {
  /** `screening_questions.id`. Stable across the call; never derived, never random. */
  id: string;
  /**
   * 1-based position, and the ONLY handle the interviewer is ever given. It
   * never receives the id, so "never mention internal topic IDs" holds because
   * it has none to mention, not because it was asked not to.
   */
  number: number;
  /**
   * The question text, snapshotted when the ledger was built. A recruiter
   * editing the campaign's questions mid-call cannot renumber a conversation
   * that is already half-finished.
   */
  prompt: string;
  status: ScreeningTopicStatus;
  askedAt: string | null;
  completedAt: string | null;
  /** One line on what the candidate actually evidenced. Audit only — never scored. */
  evidenceSummary: string | null;
  /**
   * Was this topic opened by the WORKER's stamp rather than by `next_topic`?
   *
   * The stamp is a guess. It fires when an interviewer turn ends on a question
   * with a primary question outstanding, and it cannot see what was actually
   * asked — while the interviewer's own prompt tells it to probe after every
   * answer, so the turn being stamped is routinely a follow-up on the topic
   * that was just settled. Recording how a topic was opened is what lets the
   * evaluator take a wrong guess back; a topic the interviewer asked for
   * through the tool is never second-guessed.
   *
   * Absent on every ledger written before this existed, which reads as "the
   * tool opened it" — the safe direction, since it only ever withholds a
   * correction.
   */
  openedByStamp?: boolean;
  /**
   * Has a stamp on this topic been taken back? See {@link takeBackWrongStamp}.
   *
   * A record, not a gate — the correction is bounded by the wrap-up phase
   * rather than by a per-topic count, because bounding it here burned a topic
   * outright on the second consecutive improvised probe. Worth storing anyway:
   * a topic the worker guessed at twice is the visible trace of an interviewer
   * that never called `next_topic`.
   */
  rolledBack?: boolean;
}

export interface ScreeningTopicLedger {
  rulesVersion: string;
  /**
   * Optimistic-concurrency token. The persistence layer only writes when the
   * stored version still matches the one it read, so two control events racing
   * on the same call cannot interleave halfway through a transition.
   */
  version: number;
  currentTopicId: string | null;
  topics: ScreeningTopic[];
  phase: ScreeningPhase;
  startedAt: string;
  /**
   * The backstop, not a target. See `SCREENING_CALL_BACKSTOP_MINUTES`: a call
   * is paced per answer and ends when its topics are covered, so reaching this
   * means something went wrong rather than that the interview ran long.
   */
  deadlineAt: string;
  wrapUpAt: string;
  /**
   * When the answer currently outstanding stops being the interviewer's problem
   * and it should move on. Null whenever no question is waiting on a reply —
   * between topics, and once the call is over.
   *
   * The clock is per ANSWER rather than per call, so a slow reply costs its own
   * topic and can never reach into the topics behind it. It is stored rather
   * than kept in the worker because the worker can restart mid-call, and a lost
   * timer would leave a topic open with nothing to close it.
   */
  answerDueAt: string | null;
  /**
   * When the candidate started speaking on the outstanding question, or null
   * if they have not yet.
   *
   * Recorded as EVIDENCE only — "how long they took to start" is worth having
   * on the transcript. It does NOT move `answerDueAt` (decision 2026-08-25):
   * restarting the budget here made the on-screen counter jump up at the first
   * word, and a timer that runs backwards reads as broken however generous the
   * extra minute is.
   */
  answerStartedAt: string | null;
  /**
   * Ids of control events already applied, most recent last. A duplicate
   * delivery replays the stored directive instead of settling one answer
   * twice, which would advance the call two topics on one spoken answer and
   * leave the skipped one asked by nobody. Bounded, because a call is minutes long and an event that arrives
   * fifty turns late is not a duplicate worth honouring.
   */
  handledEventIds: string[];
  /** How many times the turn evaluator failed. Diagnostics; never a penalty. */
  evaluatorFailures: number;
  /**
   * How many answers the candidate GAVE and we failed to transcribe.
   *
   * A fact about our own pipeline, never about them, and the distinction is the
   * whole reason it is stored. The screening score is the weighted mean over
   * every rubric dimension, and a dimension with no evidence scores 0 — so an
   * answer lost between the microphone and the transcript is indistinguishable,
   * in the score, from one the candidate refused to give. Both read as a 0 that
   * says "they established nothing".
   *
   * The worker is the only party that can tell them apart: OpenAI Realtime is
   * speech-to-speech, so the model hears the audio natively and the interviewer
   * carries on normally, while the TEXT comes from a separate transcription
   * sidecar that can fail and return nothing. When it does, the conversation
   * sounds perfect and the record is empty.
   *
   * Counted here so a recruiter reading a 0 is told the call may have been
   * mis-scored, rather than being left to infer it from a transcript in which
   * the only trace of the candidate answering is the interviewer thanking them
   * for it. Diagnostics; never a penalty, and never an input to any decision.
   *
   * Absent on every ledger written before 2026-08-28, which reads as 0 — the
   * honest default, since nothing observed it then.
   */
  unheardAnswers?: number;
}

/** The interviewer's marching orders for one turn. */
/**
 * What the interviewer does next.
 *
 * **Deliberately small.** It used to carry `followUpQuestion`, `followUpsLeft`
 * and an `awaitingAnswer` boolean, all three of which existed to describe the
 * probe machinery — including the boolean, which was needed only because
 * `ask_follow_up` could not tell "probe this thin answer" from "they have not
 * spoken yet". With probes gone the task itself says everything: `await_answer`
 * IS awaiting an answer, and there is no probe to draft or budget to report.
 */
export interface ScreeningDirective {
  task: ScreeningTask;
  topicNumber: number | null;
  topicPrompt: string | null;
  remainingUnasked: number;
  phase: ScreeningPhase;
}

/** What the turn evaluator reports back. See `services/screening-turn.ts`. */
export interface TopicTurnDecision {
  /**
   * Which topic the exchange actually covered, 1-based, or null if none did.
   *
   * This is the self-healing half of the design. The interviewer is told to
   * call `next_topic` before raising anything, but a model's tool discipline is
   * not a guarantee — and if it raised topic 4 without saying so, the ledger
   * would hold topic 4 `pending` forever and the close guard would refuse to
   * let the call end. Reading which topic was genuinely addressed closes that
   * loop without trusting the tool call.
   */
  addressedTopicNumber: number | null;
  /**
   * Did the candidate cover this topic?
   *
   * Two values, not three. `needs_follow_up` went with the probes (2026-08-27):
   * it existed only to ask for one, and with nothing to ask it collapsed into
   * `insufficient`, which is what it already became whenever the allowance had
   * run out. It is a statement about COVERAGE, never about the person — nothing
   * in `src/lib/screening-scoring/` reads it.
   */
  topicStatus: "complete" | "insufficient";
  evidenceSummary: string;
  confidence: "low" | "medium" | "high";
}

export interface LedgerQuestion {
  id: string;
  prompt: string;
}

// ─── Construction ───────────────────────────────────────────────────────────

/**
 * Build the ledger for a call that is about to start.
 *
 * `questions` must arrive in the order the interviewer's prompt lists them —
 * both come from `fetchScreeningQuestionsByCampaignId`, ordered by
 * `sort_order`, so "topic 3" means the same thing on both sides of the wire.
 */
export function createTopicLedger(params: {
  questions: LedgerQuestion[];
  startedAt: string;
}): ScreeningTopicLedger {
  const { questions, startedAt } = params;
  const startedMs = Date.parse(startedAt);
  const deadlineMs = startedMs + SCREENING_CALL_BACKSTOP_MINUTES * 60_000;
  // Never before the start: a call whose whole budget is shorter than the
  // reserve would open already wrapping up, which is not a coherent state.
  const wrapUpMs = Math.max(startedMs, deadlineMs - SCREENING_WRAP_UP_RESERVE_MS);

  return {
    rulesVersion: SCREENING_TOPIC_RULES_VERSION,
    version: 1,
    currentTopicId: null,
    topics: questions.map((q, i) => ({
      id: q.id,
      number: i + 1,
      prompt: q.prompt,
      status: "pending",
      askedAt: null,
      completedAt: null,
      evidenceSummary: null,
    })),
    phase: "interviewing",
    startedAt,
    deadlineAt: new Date(deadlineMs).toISOString(),
    wrapUpAt: new Date(wrapUpMs).toISOString(),
    // Nothing has been asked yet, so nothing is owed an answer.
    answerDueAt: null,
    answerStartedAt: null,
    handledEventIds: [],
    evaluatorFailures: 0,
    unheardAnswers: 0,
  };
}

// ─── Reading ────────────────────────────────────────────────────────────────

export function findTopicById(
  ledger: ScreeningTopicLedger,
  id: string | null,
): ScreeningTopic | null {
  if (!id) return null;
  return ledger.topics.find((t) => t.id === id) ?? null;
}

/** The earliest topic never raised, in configured order. */
export function earliestPendingTopic(
  ledger: ScreeningTopicLedger,
): ScreeningTopic | null {
  return ledger.topics.find((t) => t.status === "pending") ?? null;
}

export function remainingUnasked(ledger: ScreeningTopicLedger): number {
  return ledger.topics.filter((t) => t.status === "pending").length;
}

export function hasHandledEvent(
  ledger: ScreeningTopicLedger,
  eventId: string | null,
): boolean {
  return eventId !== null && ledger.handledEventIds.includes(eventId);
}

/**
 * The directive implied by the ledger as it stands, with no new information.
 *
 * Used for a replayed event — the answer to "what should I be doing?" must be
 * the same the second time it is asked, or a retried delivery would advance a
 * conversation that never moved.
 */
export function currentDirective(
  ledger: ScreeningTopicLedger,
): ScreeningDirective {
  const current = findTopicById(ledger, ledger.currentTopicId);
  const unasked = remainingUnasked(ledger);

  // A question is on the floor. There is nothing for the interviewer to do but
  // let them answer it — no probe to draft, and none to be tempted by.
  if (current && current.status === "in_progress") {
    return {
      task: "await_answer",
      topicNumber: current.number,
      topicPrompt: current.prompt,
      remainingUnasked: unasked,
      phase: ledger.phase,
    };
  }

  const next = earliestPendingTopic(ledger);
  if (next) {
    return {
      task: "ask_primary_question",
      topicNumber: next.number,
      topicPrompt: next.prompt,
      remainingUnasked: unasked,
      phase: ledger.phase,
    };
  }

  return {
    task: "close",
    topicNumber: null,
    topicPrompt: null,
    remainingUnasked: 0,
    phase: ledger.phase,
  };
}

// ─── Transitions ────────────────────────────────────────────────────────────

export interface LedgerStep {
  ledger: ScreeningTopicLedger;
  directive: ScreeningDirective;
}

/**
 * Mark the next topic as raised and hand it to the interviewer.
 *
 * Idempotent by design, which matters because the tool call that triggers it
 * can be retried by the worker on a timeout: re-asking while a topic is already
 * `in_progress` and has drawn no follow-ups returns that same topic without a
 * second `askedAt` stamp and without burning the next one. Two topics raised by
 * one question is the failure mode this prevents, and it is invisible from the
 * transcript.
 */
export function beginNextTopic(
  ledger: ScreeningTopicLedger,
  now: string,
  eventId: string | null = null,
  options: { stamped?: boolean } = {},
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);

  const current = findTopicById(ledger, ledger.currentTopicId);
  if (current && current.status === "in_progress") {
    // Nothing has happened since we raised this topic, so the interviewer is
    // asking for the same one twice. Hand it back unchanged.
    if (ledger.answerStartedAt === null) {
      return {
        ledger: rememberEvent(ledger, eventId),
        directive: currentDirective(ledger),
      };
    }

    // The candidate HAS answered and the interviewer is moving on, arriving
    // before the evaluator has reported. That is the ordinary order, not an
    // edge case: the model calls `next_topic` about half a second after the
    // candidate stops, and `turn_completed` is an OpenAI round-trip of three to
    // five seconds behind it.
    //
    // Treating that as a duplicate — which is what `answerStartedAt` was added
    // to tell apart — swallowed the call entirely. The next topic was never
    // raised, so `answerDueAt` was never re-armed and `applyAnswerStarted`
    // no-ops while nothing is open: the candidate's countdown vanished after
    // the first answer and never came back, and the topic itself stayed
    // `pending` for the rest of the call, scoring 0 on whatever the rubric
    // graded it against. The interviewer had already spent its one tool call,
    // so nothing raised it later either.
    //
    // Settled `complete` rather than `insufficient` for the same reason
    // `applyEvaluatorFailure` does: they answered, and our evaluator being
    // slower than the conversation says nothing about what they said. The
    // verdict still lands moments later and fills in the evidence summary
    // through `annotateSettledTopic`.
    const settled = settleAndAdvance(
      ledger,
      current.id,
      "complete",
      current.evidenceSummary,
      now,
      null,
    );
    return beginNextTopic(settled.ledger, now, eventId, options);
  }

  const next = earliestPendingTopic(ledger);
  if (!next) {
    // Nothing left to raise. The close guard, not this, decides whether the
    // call may actually end.
    return {
      ledger: rememberEvent(bumpVersion(ledger), eventId),
      directive: currentDirective(ledger),
    };
  }

  const topics = ledger.topics.map((t) =>
    t.id === next.id
      ? {
          ...t,
          status: "in_progress" as const,
          askedAt: now,
          // How it was opened, so a wrong guess can be taken back. `rolledBack`
          // is deliberately NOT reset here: it bounds the correction across the
          // whole call, and a topic re-stamped after being handed back is
          // exactly the case that must not loop.
          openedByStamp: options.stamped === true,
        }
      : t,
  );
  const updated = rememberEvent(
    bumpVersion({
      ...ledger,
      topics,
      currentTopicId: next.id,
      // The one clock for this question, armed now that it has been asked. It
      // only counts down; speaking does not restart it.
      answerDueAt: answerDeadline(now),
      answerStartedAt: null,
    }),
    eventId,
  );

  return {
    ledger: updated,
    directive: {
      task: "ask_primary_question",
      topicNumber: next.number,
      topicPrompt: next.prompt,
      remainingUnasked: remainingUnasked(updated),
      phase: updated.phase,
    },
  };
}

/**
 * The single orchestration function: read the evaluator's verdict on the turn
 * that just finished, and decide what the interviewer does next.
 *
 * The rules run in this order and none of them may be reordered:
 *
 *  1. `complete` → save the evidence summary and move to the next pending topic.
 *  2. `insufficient` → record it and move to the next pending topic anyway.
 *  3. The next topic is always the earliest remaining `pending`, in configured
 *     order — never the most promising, never the quickest.
 *  4. `wrapping_up` is only reachable once nothing is `pending`.
 *  5. `finished` is only reachable after the closing message (see `finish`).
 *
 * **Rules 1 and 2 differ only in what is recorded**, which is the whole of the
 * 2026-08-27 simplification: there used to be a branch between them that kept
 * the topic open and spent a probe. An answer that is vague is not going to be
 * rescued by a second question often enough to pay for it, and the minutes
 * spent trying come out of topics nobody has raised yet — where the cost is a
 * guaranteed zero rather than a thin answer.
 */
export function decideNextInterviewAction(
  ledger: ScreeningTopicLedger,
  decision: TopicTurnDecision,
  now: string,
  eventId: string | null = null,
  expectedTopicId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);

  // A LATE reading. Evaluating a turn takes seconds, and in that time the
  // interviewer may have called `next_topic` and moved on — so the topic this
  // verdict is about is no longer the open one. Applying it now would grade one
  // answer against a different question, which is the single worst thing this
  // module could do quietly.
  //
  // So a late reading may only annotate the topic it was actually about, and
  // changes nothing about the flow. This is what lets the tool skip the queue:
  // arriving out of order is safe rather than merely unlikely.
  if (expectedTopicId && ledger.currentTopicId !== expectedTopicId) {
    return annotateSettledTopic(ledger, expectedTopicId, decision, eventId);
  }

  // The evaluator may have spotted the interviewer raising a topic without
  // announcing it. Reconcile before judging, so the verdict lands on the topic
  // the candidate was actually answering.
  const reconciled = reconcileAddressedTopic(ledger, decision, now);
  const current = findTopicById(reconciled, reconciled.currentTopicId);

  if (!current || current.status !== "in_progress") {
    // A turn with no topic open — small talk, a repeat request, or an answer
    // that arrived before anything was raised. Nothing to record.
    return {
      ledger: rememberEvent(reconciled, eventId),
      directive: currentDirective(reconciled),
    };
  }

  const summary = decision.evidenceSummary.trim() || null;

  // **Every answer settles its topic** (decision 2026-08-27). There used to be
  // a branch here that spent a probe and left the topic open when the evaluator
  // said the answer was thin. It is gone, along with the budget that bounded
  // it: one question, one answer, next question.
  //
  // What that costs is depth on a vague answer, and it is a real cost. What it
  // buys is a call nobody has to reason about — the probe machinery was the
  // single largest source of complexity on both sides of the wire, and most of
  // it existed to observe and correct probes the model asked without being told
  // to. It is also time back: a probe spent a whole extra minute on a topic
  // already asked, and the evidence for a rubric dimension is read from the
  // WHOLE transcript, never from one answer.
  const settled: ScreeningTopicStatus =
    decision.topicStatus === "complete" ? "complete" : "insufficient";

  return settleAndAdvance(reconciled, current.id, settled, summary, now, eventId);
}

/**
 * Cross the wrap-up line: stop probing, raise whatever is left, close warmly.
 *
 * The topic in progress is settled on the evidence it already has rather than
 * being abandoned — it was asked, and the candidate answered it, so it is not a
 * gap. What it is not given is another probe.
 */
export function enterWrapUp(
  ledger: ScreeningTopicLedger,
  now: string,
  eventId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId) || ledger.phase !== "interviewing") {
    return replay(ledger);
  }

  const wrapping: ScreeningTopicLedger = bumpVersion({
    ...ledger,
    phase: "wrapping_up",
  });

  const current = findTopicById(wrapping, wrapping.currentTopicId);
  if (current && current.status === "in_progress") {
    // **A topic open at the wrap-up line has been asked and not answered.**
    // This used to read `evidenceSummary ? "complete" : "insufficient"`, which
    // was there for a topic the probe branch had kept open WITH evidence
    // recorded on it. Every answer settles its own topic now, so an open one
    // has no summary by construction and that branch was unreachable.
    return settleAndAdvance(wrapping, current.id, "insufficient", null, now, eventId);
  }

  return {
    ledger: rememberEvent(wrapping, eventId),
    directive: currentDirective(wrapping),
  };
}

/**
 * The candidate started speaking: start their minute from here.
 *
 * Idempotent, and that is the whole safeguard. Only the FIRST speech onset per
 * question starts the clock — otherwise a candidate who paused and resumed
 * would be handed a fresh minute every time they took a breath, and the budget
 * would mean nothing.
 *
 * A no-op when no topic is open, so speech during the greeting or after the
 * goodbye starts nothing.
 */
/**
 * Record that an answer the candidate gave never reached the transcript.
 *
 * **It counts, and it changes nothing else.** No topic is settled, no topic is
 * re-opened, no clock is touched and no directive changes — the call carries on
 * exactly as it would have. That restraint is the design:
 *
 * - **It cannot be attributed to a topic, so it is not.** The worker only knows
 *   an answer was lost once the call has MOVED ON — the loss is detected when
 *   the candidate starts answering the next question — so `currentTopicId` by
 *   then is the wrong topic. Blaming it would be a stamp made in error, which
 *   this module has learned twice over is the one kind of mistake nothing
 *   downstream can undo. A call-level count is the honest unit.
 * - **It must never look like a verdict.** `insufficient` says "we asked and
 *   moved on"; this says "we asked, they answered, and we lost it". Settling a
 *   topic here would write our own outage onto the candidate's record, which is
 *   the same rule `applyEvaluatorFailure` follows when it settles `complete`.
 * - **It never delays the call.** The event is fire-and-forget at the worker
 *   and a pure increment here, because a candidate is mid-conversation and a
 *   report about a lost answer is not worth a round-trip of their time.
 *
 * What it buys is the one thing the score cannot say on its own: that a 0 may
 * be ours rather than theirs.
 */
export function applyAnswerUnheard(
  ledger: ScreeningTopicLedger,
  _now: string,
  eventId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);

  const counted = rememberEvent(
    bumpVersion({ ...ledger, unheardAnswers: (ledger.unheardAnswers ?? 0) + 1 }),
    eventId,
  );

  return { ledger: counted, directive: currentDirective(counted) };
}

export function applyAnswerStarted(
  ledger: ScreeningTopicLedger,
  now: string,
  eventId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);

  const current = findTopicById(ledger, ledger.currentTopicId);
  if (!current || current.status !== "in_progress" || ledger.answerStartedAt) {
    return noop(ledger, eventId);
  }

  // Records WHEN they began, and nothing else. The deadline was armed when the
  // question was asked and is deliberately left alone: re-arming here made the
  // counter jump UP at the first word, which reads as a timer running backwards
  // however generous the extra minute actually is.
  const started = rememberEvent(
    bumpVersion({ ...ledger, answerStartedAt: now }),
    eventId,
  );

  return { ledger: started, directive: currentDirective(started) };
}

/**
 * The candidate's minute on the current answer ran out: settle the topic on
 * whatever it already has and move on.
 *
 * This is the per-answer budget doing its job, and it is deliberately the same
 * settle the wrap-up performs — the topic was raised and the candidate had a
 * fair minute on it, so it is a thin answer, not a gap. `complete` when they
 * evidenced something before the clock went, `insufficient` when they did not.
 *
 * A no-op when nothing is outstanding (`answerDueAt` null, or no topic in
 * progress). That matters more than it looks: the worker's timer and the
 * evaluator race constantly — an answer that was settled two seconds ago will
 * still have a timer in flight for it — and a timeout that could settle a topic
 * nobody was answering would cut the NEXT question short.
 */
export function applyAnswerTimeout(
  ledger: ScreeningTopicLedger,
  now: string,
  eventId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);

  const current = findTopicById(ledger, ledger.currentTopicId);
  if (!ledger.answerDueAt || !current || current.status !== "in_progress") {
    return noop(ledger, eventId);
  }

  return settleAndAdvance(
    ledger,
    current.id,
    current.evidenceSummary ? "complete" : "insufficient",
    current.evidenceSummary,
    now,
    eventId,
  );
}

/**
 * The closing guard, and the reason this module is enforcement rather than
 * advice: a request to end the call is REFUSED while a question is still owed
 * an answer, and answered with what to do instead.
 *
 * The refusal is deliberately mute about itself. The caller turns this into
 * "raise topic N next", or "wait for them", and nothing more — never "you
 * forgot a question", never "the system requires". The candidate hears an
 * interviewer moving on, or giving them a moment, because from where they sit
 * that is all that happened.
 */
export function resolveCloseRequest(
  ledger: ScreeningTopicLedger,
  now: string,
  eventId: string | null = null,
): LedgerStep & { allowed: boolean } {
  if (hasHandledEvent(ledger, eventId)) {
    const directive = currentDirective(ledger);
    return { ledger, directive, allowed: directive.task === "close" };
  }

  // A question that has been ASKED and not yet answered (decision 2026-08-25).
  //
  // The guard used to look only at `pending` — topics never raised — so the
  // very last question of the call did not block a close at all. The
  // interviewer asks it, sees `topics not yet raised: 0`, calls
  // `end_interview` before the candidate has drawn breath, and the allow path
  // below nulls `answerDueAt`: their minute is destroyed, the countdown
  // vanishes, and the interviewer says "Goodbye!" over a question nobody
  // answered.
  //
  // `answerStartedAt` is the discriminator, exactly as it is in
  // `beginNextTopic`: null means nothing has happened since the question was
  // raised, so nobody has answered it. Non-null means they DID answer and the
  // interviewer is closing ahead of the evaluator — the ordinary order, three
  // to five seconds of OpenAI round-trip behind the conversation — and
  // refusing there would deadlock the close on our own latency.
  //
  // Nothing is written on this path: no version bump, and above all
  // `answerDueAt` is left alone, so the minute keeps running through the
  // refusal.
  const current = findTopicById(ledger, ledger.currentTopicId);
  if (current?.status === "in_progress" && ledger.answerStartedAt === null) {
    return {
      ledger: rememberEvent(ledger, eventId),
      directive: currentDirective(ledger),
      allowed: false,
    };
  }

  if (earliestPendingTopic(ledger)) {
    const step = beginNextTopic(ledger, now, eventId);
    return { ...step, allowed: false };
  }

  const finished = rememberEvent(
    bumpVersion({
      ...ledger,
      phase: "finished",
      currentTopicId: null,
      answerDueAt: null,
      answerStartedAt: null,
    }),
    eventId,
  );
  return {
    ledger: finished,
    directive: { ...currentDirective(finished), task: "close" },
    allowed: true,
  };
}

/**
 * What happens when the turn evaluator could not be reached.
 *
 * The topic is settled as `complete` and the call moves on. `complete` rather
 * than `insufficient` on purpose: the candidate DID answer, the evaluator's
 * absence says nothing about what they said, and this record is read by a human
 * later. Writing "insufficient" would put our outage on their file. It also
 * matches the bias the proctoring rules take — degrade toward missing something
 * rather than toward accusing a real person.
 *
 * The worst case degrades cleanly: with the evaluator down for a whole call,
 * every topic is raised once, no follow-ups are asked, and the interview closes
 * properly. That is the guaranteed-coverage minimum, which is the point.
 */
export function applyEvaluatorFailure(
  ledger: ScreeningTopicLedger,
  now: string,
  eventId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);

  const counted: ScreeningTopicLedger = {
    ...ledger,
    evaluatorFailures: ledger.evaluatorFailures + 1,
  };
  const current = findTopicById(counted, counted.currentTopicId);

  if (!current || current.status !== "in_progress") {
    return {
      ledger: rememberEvent(bumpVersion(counted), eventId),
      directive: currentDirective(counted),
    };
  }

  return settleAndAdvance(
    counted,
    current.id,
    "complete",
    current.evidenceSummary ??
      "Answer recorded; not evaluated (turn evaluator unavailable).",
    now,
    eventId,
  );
}

/** Close the ledger once the interviewer has actually delivered its goodbye. */
export function finish(
  ledger: ScreeningTopicLedger,
  eventId: string | null = null,
): LedgerStep {
  if (hasHandledEvent(ledger, eventId)) return replay(ledger);
  const finished = rememberEvent(
    bumpVersion({
      ...ledger,
      phase: "finished",
      currentTopicId: null,
      answerDueAt: null,
      answerStartedAt: null,
    }),
    eventId,
  );
  return { ledger: finished, directive: currentDirective(finished) };
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Settle one topic and hand back the directive for whatever comes next.
 *
 * Advancing does NOT raise the next topic — that stays the interviewer's move,
 * via `beginNextTopic`, so a topic is never stamped "asked" by a state
 * transition that happened while nobody said anything.
 */
function settleAndAdvance(
  ledger: ScreeningTopicLedger,
  topicId: string,
  status: Extract<ScreeningTopicStatus, "complete" | "insufficient">,
  summary: string | null,
  now: string,
  eventId: string | null,
): LedgerStep {
  const topics = ledger.topics.map((t) =>
    t.id === topicId
      ? { ...t, status, completedAt: now, evidenceSummary: summary ?? t.evidenceSummary }
      : t,
  );
  const advanced = rememberEvent(
    bumpVersion({
      ...ledger,
      topics,
      currentTopicId: null,
      answerDueAt: null,
      answerStartedAt: null,
    }),
    eventId,
  );

  const next = earliestPendingTopic(advanced);
  if (!next) {
    // Everything has been raised. Only now may the phase become `wrapping_up`;
    // a call that was already wrapping up stays there.
    const phase: ScreeningPhase =
      advanced.phase === "interviewing" ? "wrapping_up" : advanced.phase;
    const ready = { ...advanced, phase };
    return { ledger: ready, directive: currentDirective(ready) };
  }

  return { ledger: advanced, directive: currentDirective(advanced) };
}

/**
 * Fold in the evaluator's reading of which topic was actually addressed.
 *
 * Two corrections, and they run in opposite directions:
 *
 *  1. A topic the interviewer raised WITHOUT announcing is marked as raised.
 *     Without this the ledger would hold it `pending` forever and the close
 *     guard would refuse to end the call.
 *  2. A topic the WORKER stamped that the interviewer never actually raised is
 *     handed back to `pending`. See {@link takeBackWrongStamp}.
 *
 * Beyond those it can never un-ask a topic, reopen a settled one, or move the
 * conversation backwards. A reading that names a topic already dealt with is
 * otherwise ignored rather than trusted.
 */
function reconcileAddressedTopic(
  ledger: ScreeningTopicLedger,
  decision: TopicTurnDecision,
  now: string,
): ScreeningTopicLedger {
  const number = decision.addressedTopicNumber;
  if (number === null) return ledger;

  const addressed = ledger.topics.find((t) => t.number === number);
  if (!addressed) return ledger;
  if (addressed.status !== "pending") return takeBackWrongStamp(ledger, addressed);

  const current = findTopicById(ledger, ledger.currentTopicId);
  const topics = ledger.topics.map((t) => {
    if (t.id === addressed.id) {
      return { ...t, status: "in_progress" as const, askedAt: t.askedAt ?? now };
    }
    // The topic the ledger thought was open was not the one being answered.
    // It was still genuinely raised, so it is settled rather than reset — but
    // on no evidence, because none was reported for it.
    if (current && t.id === current.id && current.status === "in_progress") {
      return { ...t, status: "insufficient" as const, completedAt: now };
    }
    return t;
  });

  return bumpVersion({ ...ledger, topics, currentTopicId: addressed.id });
}

/**
 * Take back a topic the worker stamped that the interviewer never raised.
 *
 * The stamp exists because the model ignores `next_topic`, and without it no
 * answer on such a call ever carries a deadline: `answerDueAt` is only set by
 * opening a topic, so the candidate's countdown never appears and nothing moves
 * a silent answer along. It fires on an interviewer turn that ends on a
 * question with a primary question outstanding — and it cannot hear WHAT was
 * asked. The interviewer's own instructions tell it to probe after every
 * answer, and a probe needs no tool call, so the turn being stamped is
 * routinely a follow-up on the topic that was just settled.
 *
 * That was the one error this module called unrecoverable: the topic is marked
 * asked, nothing will ever put its question to the candidate, and the rubric
 * dimension behind it scores 0 for a question nobody heard.
 *
 * The evaluator can see what the worker cannot. When it reports that the
 * exchange addressed a topic already dealt with, while the ledger believes a
 * DIFFERENT topic — one only a stamp opened — is in progress, the honest
 * reading is that the stamp guessed wrong. So the guess is optimistic and this
 * takes it back: the same division of labour as everywhere else here, where the
 * worker acts on what it can observe and the reading corrects it.
 *
 * Three limits, each load-bearing:
 *
 * - **Only a stamped topic.** A topic the interviewer asked for through
 *   `next_topic` is a stated intention, not a guess, and is never
 *   second-guessed.
 * - **Not while wrapping up**, which is the bound on the loop — and the bound
 *   belongs there rather than on the topic. It was one rollback per topic at
 *   first, on the reasoning that a candidate whose answer wanders back to an
 *   earlier topic looks exactly like an interviewer probing one, so an
 *   unlimited correction would loop the call. That priced the trade backwards:
 *   two long improvised probes in a row spent the allowance and BURNED the next
 *   topic — marked `complete`, never asked, no evidence, and a record claiming
 *   it was. A stall is the better failure and this module says so everywhere
 *   else: the topic stays `pending`, the close guard will not end the call, the
 *   block keeps handing it over, and whatever was said is still in the
 *   transcript the scorer reads. Wrap-up is where correcting stops, because its
 *   reserve exists to raise whatever is left once each and a rollback would
 *   fight the one mechanism guaranteeing coverage — and because a stamp is far
 *   likelier to be genuine by then, the interviewer having been told to raise
 *   the remaining topics and nothing else. `rolledBack` stays as a record that
 *   it happened.
 * - **The clock goes with it.** Nothing is outstanding once the question is
 *   un-asked, so leaving a deadline armed would time out an answer to a
 *   question that no longer exists.
 */
function takeBackWrongStamp(
  ledger: ScreeningTopicLedger,
  addressed: ScreeningTopic,
): ScreeningTopicLedger {
  const current = findTopicById(ledger, ledger.currentTopicId);
  if (
    !current ||
    current.id === addressed.id ||
    current.status !== "in_progress" ||
    current.openedByStamp !== true ||
    ledger.phase !== "interviewing"
  ) {
    return ledger;
  }

  const topics = ledger.topics.map((t) => {
    if (t.id === current.id) {
      return {
        ...t,
        status: "pending" as const,
        askedAt: null,
        openedByStamp: false,
        rolledBack: true,
      };
    }
    return t;
  });

  return bumpVersion({
    ...ledger,
    topics,
    currentTopicId: null,
    answerDueAt: null,
    answerStartedAt: null,
  });
}

/**
 * Record what a late reading found, without letting it steer the call.
 *
 * Only ever fills a blank summary: if the topic already has one — from the
 * wrap-up settle, or from the evaluator-failure fallback — that was written
 * with the flow, and a reading that arrived afterwards does not get to
 * overwrite it.
 *
 * It may also correct a status that was GUESSED. `beginNextTopic` settles the
 * open topic `complete` the moment the tool arrives with an answer behind it,
 * because reading the ordinary order as a duplicate swallowed the next topic
 * entirely — so it has to guess, and it guesses in the candidate's favour. The
 * verdict lands seconds later and knows what the answer was actually like.
 * Leaving the guess standing records a thin answer as `complete`, which is a
 * lie in a record a person reads.
 *
 * `complete` with NO summary is the signature of that guess, and only of it:
 * every other settle writes one, including the two that must never be
 * downgraded — the evaluator-failure fallback (our outage stays off the
 * candidate's file) and the wrap-up settle, which records `insufficient`
 * outright when it has nothing.
 */
function annotateSettledTopic(
  ledger: ScreeningTopicLedger,
  topicId: string,
  decision: TopicTurnDecision,
  eventId: string | null,
): LedgerStep {
  const summary = decision.evidenceSummary.trim();
  const target = findTopicById(ledger, topicId);

  const guessed = target?.status === "complete" && !target.evidenceSummary;
  const status: ScreeningTopicStatus | null =
    guessed && decision.topicStatus !== "complete" ? "insufficient" : null;

  if (!target || (!summary && !status) || (target.evidenceSummary && !status)) {
    return noop(ledger, eventId);
  }

  const topics = ledger.topics.map((t) =>
    t.id === topicId
      ? {
          ...t,
          ...(summary && !t.evidenceSummary ? { evidenceSummary: summary } : {}),
          ...(status ? { status } : {}),
        }
      : t,
  );
  const annotated = rememberEvent(bumpVersion({ ...ledger, topics }), eventId);
  return { ledger: annotated, directive: currentDirective(annotated) };
}

/** When a question ASKED at `now` runs out of time. */
function answerDeadline(now: string): string {
  return new Date(Date.parse(now) + SCREENING_ANSWER_BUDGET_MS).toISOString();
}

/**
 * Hand the ledger back untouched, with whatever it is already asking for.
 *
 * The shape every no-op transition returns, written out eleven times before
 * this: seven idempotency guards and four "nothing to do here" branches. Each
 * copy is a place a future transition can quietly return a stale directive
 * instead of the current one.
 */
function replay(ledger: ScreeningTopicLedger): LedgerStep {
  return { ledger, directive: currentDirective(ledger) };
}

/**
 * A no-op that still records the event, so a retry of it is recognised.
 *
 * Safe to compose with {@link replay}: `currentDirective` reads only
 * `currentTopicId`, `topics`, `phase` and `answerStartedAt`, none of which
 * `rememberEvent` touches.
 */
function noop(ledger: ScreeningTopicLedger, eventId: string | null): LedgerStep {
  return replay(rememberEvent(ledger, eventId));
}

function bumpVersion(ledger: ScreeningTopicLedger): ScreeningTopicLedger {
  return { ...ledger, version: ledger.version + 1 };
}

function rememberEvent(
  ledger: ScreeningTopicLedger,
  eventId: string | null,
): ScreeningTopicLedger {
  if (!eventId || ledger.handledEventIds.includes(eventId)) return ledger;
  const handledEventIds = [...ledger.handledEventIds, eventId].slice(
    -HANDLED_EVENT_MEMORY,
  );
  return { ...ledger, handledEventIds };
}
