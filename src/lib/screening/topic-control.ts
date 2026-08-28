/**
 * Runtime topic control for the voice screening — the orchestration that turns
 * one report from the agent worker into one instruction back to it.
 *
 * It composes, in the usual order: data layer (load the ledger) → service
 * (read the turn, when there is one to read) → rule layer
 * (`src/lib/screening/topic-ledger.ts` decides) → data layer (persist). It
 * performs NO auth (the route's `AGENT_API_SECRET` is the gate), NO Zod
 * validation (the route does that), and it never transitions an application —
 * the whole feature is about which question gets asked next, and nothing else.
 *
 * It exists as a pipeline rather than inside the route for the same reason
 * `composeScreeningInstructions` does: it runs on an injected `db` because its
 * caller has no recruiter session, and keeping it out of the route is what
 * makes it testable.
 *
 * **Nothing here may ever be allowed to end a live call.** Every failure path —
 * a dead evaluator, a lost write, a row that has already been finalized —
 * resolves to a usable directive and returns it. A candidate is on the phone.
 */
import {
  fetchScreeningQuestionsByCampaignId,
  fetchScreeningTopicState,
  saveScreeningTopicState,
} from "@/lib/data/screening-questions";
import { fetchApplicationForResponse } from "@/lib/data/candidates";
import { evaluateScreeningTurn } from "@/lib/services/screening-turn";
import type { Json } from "@/types/database.types";
import type { SupabaseDb } from "@/lib/supabase/types";
import {
  applyAnswerStarted,
  applyAnswerTimeout,
  applyAnswerUnheard,
  applyEvaluatorFailure,
  beginNextTopic,
  createTopicLedger,
  currentDirective,
  decideNextInterviewAction,
  enterWrapUp,
  findTopicById,
  hasHandledEvent,
  resolveCloseRequest,
  type LedgerStep,
  type ScreeningDirective,
  type ScreeningTopicLedger,
  type TopicTurnDecision,
} from "./topic-ledger";

/** How many times a lost optimistic write is re-read and retried. */
const WRITE_RETRIES = 1;

/**
 * Note on the legacy members below.
 *
 * `close_requested` and `topic_started`'s `stamped` flag belong to the PULL
 * protocol, in which the interviewer announced its own moves through tools and
 * the worker guessed at the ones it did not announce. Since 2026-08-25 the app
 * pushes each question and the worker speaks it, so the current worker sends
 * neither: a close is decided here and acted on there, never requested, and a
 * topic is only ever opened by a question the worker actually asked, so no
 * stamp is ever a guess.
 *
 * They are kept because workers deploy BEFORE the app: an older worker mid-
 * rollout still speaks the old protocol, and this must keep answering it.
 * Nothing new should reach for them.
 *
 * `follow_up_asked` is gone rather than kept, because follow-ups themselves are
 * gone (2026-08-27) — there is no longer a count for it to increment, so
 * accepting it would mean keeping the whole budget alive to service an event
 * nothing sends. An older worker posting one now gets a 400, which
 * `postControlEvent` already degrades from.
 */
export type ScreeningControlEvent =
  | { type: "session_started"; eventId: string; startedAt: string }
  | {
      type: "topic_started";
      eventId: string;
      /**
       * Did the WORKER stamp this, rather than the interviewer asking for it
       * through `next_topic`?
       *
       * The stamp is a guess about what an interviewer turn asked, and it is
       * wrong often enough to matter — see `takeBackWrongStamp`. Recording how
       * a topic was opened is what lets the evaluator take a wrong guess back.
       * Absent from an older worker's body, which reads as "the tool asked for
       * it": the safe direction, since it only ever withholds a correction.
       */
      stamped?: boolean;
    }
  | {
      type: "turn_completed";
      eventId: string;
      candidateText: string;
      interviewerText: string | null;
    }
  | { type: "answer_started"; eventId: string }
  | { type: "answer_timeout"; eventId: string }
  /**
   * The worker heard an answer it could not transcribe.
   *
   * **Not a quieter `answer_timeout`.** That one means nobody spoke in the time
   * allowed — a fact about the candidate. This means somebody DID and the
   * transcription sidecar returned nothing — a fact about us. They produce the
   * same 0 in the score and demand opposite readings of it, which is why the
   * worker reports this rather than letting a thin transcript speak for itself.
   */
  | { type: "answer_unheard"; eventId: string }
  | { type: "wrap_up_due"; eventId: string }
  | { type: "close_requested"; eventId: string };

export interface ScreeningControlResult {
  directive: ScreeningDirective;
  /** True only for a `close_requested` the guard actually allowed. */
  closeAllowed: boolean;
  /** Milliseconds from now until wrap-up; the worker arms its timer from this. */
  wrapUpInMs: number;
  /**
   * Milliseconds from now until the outstanding answer is out of time, or null
   * when nothing is waiting on the candidate. The worker arms — and disarms —
   * its per-answer timer from this on every single control response, so the
   * clock cannot survive the question it belonged to.
   */
  answerDueInMs: number | null;
  /**
   * True once the candidate has actually started speaking on this question.
   * The browser shows a running countdown only then — before it, the candidate
   * is thinking, and a clock ticking at somebody deciding what to say is the
   * pressure this design exists to remove.
   */
  answerRunning: boolean;
  deadlineAt: string;
}

/**
 * Apply one control event and answer with what the interviewer should do next.
 *
 * Returns `null` only when there is nothing to control — an unknown
 * application, or a campaign with no screening questions. The worker treats
 * that as "carry on unmanaged", which is the behaviour that existed before
 * this feature.
 */
export async function applyScreeningControlEvent(params: {
  applicationId: string;
  event: ScreeningControlEvent;
  db: SupabaseDb;
  now: Date;
}): Promise<ScreeningControlResult | null> {
  const { applicationId, event, db, now } = params;
  const nowIso = now.toISOString();

  const first = await loadLedger({ applicationId, event, db, nowIso });
  if (!first) return null;

  // A replay answers from the stored state and writes nothing. The interviewer
  // must get the same answer the second time it asks, or a retried delivery
  // would advance a conversation that never moved.
  if (hasHandledEvent(first.ledger, event.eventId)) {
    return result(first.ledger, currentDirective(first.ledger), false, now);
  }

  // The expensive part runs ONCE, against the ledger as it stood when the turn
  // ended. Everything after it is cheap and repeatable, which is what lets the
  // write be retried without paying for a second evaluation.
  const prepared = await prepare({ event, ledger: first.ledger, applicationId });

  let loaded: LoadedLedger | null = first;
  for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
    if (!loaded) return null;
    if (hasHandledEvent(loaded.ledger, event.eventId)) {
      return result(loaded.ledger, currentDirective(loaded.ledger), false, now);
    }

    const { step, closeAllowed } = applyPrepared(loaded.ledger, prepared, nowIso, event);

    let wrote = false;
    try {
      wrote = await saveScreeningTopicState(
        applicationId,
        step.ledger as unknown as Json,
        loaded.expectedVersion,
        db,
      );
    } catch (error) {
      logFailure("persist", applicationId, event.eventId, error);
      // Answer anyway. A lost write costs an audit row; refusing to answer
      // costs the candidate their next question.
      return result(step.ledger, step.directive, closeAllowed, now);
    }

    if (wrote) return result(step.ledger, step.directive, closeAllowed, now);

    // Someone else moved the ledger between our read and our write — the tool
    // and this evaluation now run in separate lanes on purpose, so this is
    // expected rather than exceptional. Re-read and re-apply on top of THEIR
    // version; re-writing our own would silently discard their transition.
    loaded = await loadLedger({ applicationId, event, db, nowIso }).catch(() => null);
    if (loaded && loaded.status !== "sent") break;
  }

  const fresh = loaded?.ledger ?? first.ledger;
  return result(fresh, currentDirective(fresh), false, now);
}

// ─── Loading ────────────────────────────────────────────────────────────────

interface LoadedLedger {
  ledger: ScreeningTopicLedger;
  /** Null when no ledger has been stored yet — the first write claims the row. */
  expectedVersion: number | null;
  /** The response row's status. Anything but `sent` is closed to control. */
  status: string;
}

async function loadLedger(params: {
  applicationId: string;
  event: ScreeningControlEvent;
  db: SupabaseDb;
  nowIso: string;
}): Promise<LoadedLedger | null> {
  const { applicationId, event, db, nowIso } = params;

  const row = await fetchScreeningTopicState(applicationId, db);
  if (!row) return null;

  const stored = parseLedger(row.topicState);
  if (stored) {
    return { ledger: stored, expectedVersion: stored.version, status: row.status };
  }

  // No ledger yet. Build one — including for an event that is not
  // `session_started`, because a worker that reconnected mid-call still needs
  // something to control, and a fresh ledger is a strictly safer starting point
  // than none: it holds every topic pending, so the close guard stays armed.
  const app = await fetchApplicationForResponse(applicationId, db);
  if (!app) return null;

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id, db);
  if (questions.length === 0) return null;

  const startedAt = event.type === "session_started" ? event.startedAt : nowIso;

  return {
    ledger: createTopicLedger({
      questions: questions.map((q) => ({ id: q.id, prompt: q.prompt })),
      startedAt,
    }),
    expectedVersion: null,
    status: row.status,
  };
}

function parseLedger(raw: Json | null): ScreeningTopicLedger | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as unknown as Partial<ScreeningTopicLedger>;
  if (typeof candidate.version !== "number" || !Array.isArray(candidate.topics)) {
    return null;
  }
  return candidate as ScreeningTopicLedger;
}

// ─── Preparing (the expensive half, done once) ──────────────────────────────

/**
 * What the expensive half produced, for the cheap half to apply.
 *
 * Only ONE event has an expensive half — `turn_completed`, which is an OpenAI
 * round-trip — so this carries three cases rather than one per event type.
 * It used to mirror all nine, which meant two parallel enums to hold in your
 * head, a mapping between them, and three switches to edit for every new
 * control event. Seven of those nine arms transported nothing the event did not
 * already carry.
 */
type Prepared =
  /** Nothing expensive to do; `applyPrepared` reads the event directly. */
  | { kind: "event" }
  | {
      kind: "decision";
      decision: TopicTurnDecision;
      /**
       * Which topic was open when the turn ended. If the ledger has moved past
       * it by the time this lands, the verdict may only annotate — see
       * `decideNextInterviewAction`.
       */
      expectedTopicId: string | null;
    }
  | { kind: "evaluator_failed" };

async function prepare(params: {
  event: ScreeningControlEvent;
  ledger: ScreeningTopicLedger;
  applicationId: string;
}): Promise<Prepared> {
  const { event, ledger, applicationId } = params;
  if (event.type !== "turn_completed") return { kind: "event" };

  const expectedTopicId = ledger.currentTopicId;
  const decision = await evaluateTurn({ ledger, event, applicationId });
  return decision ? { kind: "decision", decision, expectedTopicId } : { kind: "evaluator_failed" };
}

/**
 * The transitions that take nothing but the ledger, the clock and the event id.
 * A table rather than switch arms with identical bodies.
 */
const SIMPLE_TRANSITIONS: Partial<
  Record<
    ScreeningControlEvent["type"],
    (ledger: ScreeningTopicLedger, nowIso: string, eventId: string) => LedgerStep
  >
> = {
  answer_started: applyAnswerStarted,
  answer_timeout: applyAnswerTimeout,
  answer_unheard: applyAnswerUnheard,
  wrap_up_due: enterWrapUp,
};

/** The cheap, repeatable half. Pure apart from reading the clock it is handed. */
function applyPrepared(
  ledger: ScreeningTopicLedger,
  prepared: Prepared,
  nowIso: string,
  event: ScreeningControlEvent,
): { step: LedgerStep; closeAllowed: boolean } {
  // `closeAllowed` is only ever true on a close that the ledger permitted, so
  // it is answered once, in that one branch, rather than returned as false from
  // eight others.
  if (prepared.kind === "decision") {
    return {
      step: decideNextInterviewAction(
        ledger,
        prepared.decision,
        nowIso,
        event.eventId,
        prepared.expectedTopicId,
      ),
      closeAllowed: false,
    };
  }

  if (prepared.kind === "evaluator_failed") {
    return { step: applyEvaluatorFailure(ledger, nowIso, event.eventId), closeAllowed: false };
  }

  const simple = SIMPLE_TRANSITIONS[event.type];
  if (simple) return { step: simple(ledger, nowIso, event.eventId), closeAllowed: false };

  switch (event.type) {
    case "topic_started":
      return {
        step: beginNextTopic(ledger, nowIso, event.eventId, {
          stamped: event.stamped === true,
        }),
        closeAllowed: false,
      };

    case "close_requested": {
      const resolved = resolveCloseRequest(ledger, nowIso, event.eventId);
      return {
        step: { ledger: resolved.ledger, directive: resolved.directive },
        closeAllowed: resolved.allowed,
      };
    }

    // `session_started` opens the ledger and nothing else; `turn_completed`
    // never reaches here, having been answered above.
    default:
      return { step: { ledger, directive: currentDirective(ledger) }, closeAllowed: false };
  }
}

/**
 * Read the finished turn, retrying once. Returns null when the evaluator could
 * not be reached at all, which the caller turns into the documented fallback.
 *
 * The retry exists because the failure this most often sees is a timeout or a
 * rate limit, both of which a second attempt usually clears. Giving up exists
 * because the alternative is stalling a live conversation on an outage the
 * candidate cannot see, diagnose or wait out.
 */
async function evaluateTurn(params: {
  ledger: ScreeningTopicLedger;
  event: Extract<ScreeningControlEvent, { type: "turn_completed" }>;
  applicationId: string;
}): Promise<TopicTurnDecision | null> {
  const { ledger, event, applicationId } = params;

  const current = findTopicById(ledger, ledger.currentTopicId);

  const input = {
    currentTopic: current ? { number: current.number, prompt: current.prompt } : null,
    topics: ledger.topics.map((t) => ({ number: t.number, prompt: t.prompt })),
    interviewerQuestion: event.interviewerText,
    candidateAnswer: event.candidateText,
  };

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const { decision } = await evaluateScreeningTurn(input);
      return decision;
    } catch (error) {
      logFailure("evaluateTurn", applicationId, event.eventId, error, {
        attempt,
        topicNumber: current?.number ?? null,
        phase: ledger.phase,
      });
    }
  }

  return null;
}

function logFailure(
  at: string,
  applicationId: string,
  eventId: string,
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  console.error(
    JSON.stringify({
      at: `screening.topic-control.${at}`,
      applicationId,
      eventId,
      ...extra,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

// ─── Shaping the answer ─────────────────────────────────────────────────────

function result(
  ledger: ScreeningTopicLedger,
  directive: ScreeningDirective,
  closeAllowed: boolean,
  now: Date,
): ScreeningControlResult {
  return {
    directive,
    closeAllowed,
    wrapUpInMs: Math.max(0, Date.parse(ledger.wrapUpAt) - now.getTime()),
    answerDueInMs: ledger.answerDueAt
      ? Math.max(0, Date.parse(ledger.answerDueAt) - now.getTime())
      : null,
    answerRunning: ledger.answerStartedAt !== null,
    deadlineAt: ledger.deadlineAt,
  };
}
