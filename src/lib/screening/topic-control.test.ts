import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchApp,
  mockFetchQuestions,
  mockFetchTopicState,
  mockSaveTopicState,
  mockEvaluate,
} = vi.hoisted(() => ({
  mockFetchApp: vi.fn(),
  mockFetchQuestions: vi.fn(),
  mockFetchTopicState: vi.fn(),
  mockSaveTopicState: vi.fn(),
  mockEvaluate: vi.fn(),
}));

vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationForResponse: mockFetchApp,
}));
vi.mock("@/lib/data/screening-questions", () => ({
  fetchScreeningQuestionsByCampaignId: mockFetchQuestions,
  fetchScreeningTopicState: mockFetchTopicState,
  saveScreeningTopicState: mockSaveTopicState,
}));
vi.mock("@/lib/services/screening-turn", () => ({
  evaluateScreeningTurn: mockEvaluate,
}));

import { applyScreeningControlEvent } from "./topic-control";
import {
  beginNextTopic,
  createTopicLedger,
  currentDirective,
  type ScreeningTopicLedger,
} from "./topic-ledger";
import type { SupabaseDb } from "@/lib/supabase/types";
import type { Json } from "@/types/database.types";

const DB = { __brand: "admin-client" } as unknown as SupabaseDb;
const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const NOW = new Date("2026-08-24T10:00:00.000Z");

const QUESTIONS = [
  { id: "q1", prompt: "Describe a scaling problem you solved." },
  { id: "q2", prompt: "How do you decide what to test?" },
  { id: "q3", prompt: "Tell me about a disagreement on a design." },
];

function freshLedger(): ScreeningTopicLedger {
  return createTopicLedger({
    questions: QUESTIONS,
    startedAt: NOW.toISOString(),
  });
}

/** The last ledger handed to `saveScreeningTopicState`. */
function savedLedger(): ScreeningTopicLedger {
  const calls = mockSaveTopicState.mock.calls;
  return calls[calls.length - 1]?.[1] as ScreeningTopicLedger;
}

function storeLedger(ledger: ScreeningTopicLedger, status = "sent") {
  mockFetchTopicState.mockResolvedValue({
    topicState: ledger as unknown as Json,
    status,
  });
}

function evaluation(over: Record<string, unknown> = {}) {
  return {
    decision: {
      addressedTopicNumber: null,
      topicStatus: "complete",
      evidenceSummary: "Named Kafka and gave throughput figures.",
      nextAction: "next_topic",
      followUpQuestion: null,
      confidence: "high",
      ...over,
    },
    rawOutput: "{}",
    model: "gpt-4o-mini",
    promptVersion: "v1_topic_turn_control",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchApp.mockResolvedValue({ campaign_id: "camp-1" });
  mockFetchQuestions.mockResolvedValue(QUESTIONS);
  mockFetchTopicState.mockResolvedValue({ topicState: null, status: "sent" });
  mockSaveTopicState.mockResolvedValue(true);
  mockEvaluate.mockResolvedValue(evaluation());
});

describe("applyScreeningControlEvent", () => {
  it("builds a ledger from the campaign's questions on the first event", async () => {
    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "session_started", eventId: "s1", startedAt: NOW.toISOString() },
      db: DB,
      now: NOW,
    });

    expect(result?.directive.task).toBe("ask_primary_question");
    expect(result?.directive.topicPrompt).toBe("Describe a scaling problem you solved.");
    expect(savedLedger().topics).toHaveLength(3);
  });

  it("reads and writes through the injected client, never a cookie-scoped one", async () => {
    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(mockFetchTopicState).toHaveBeenCalledWith(APP_ID, DB);
    expect(mockSaveTopicState).toHaveBeenCalledWith(APP_ID, expect.anything(), null, DB);
  });

  /**
   * A campaign with no screening questions has nothing to control. The worker
   * reads `null` as "carry on unmanaged" — deliberately NOT fatal, unlike the
   * instructions route: an interviewer with no instructions has nothing to say,
   * whereas one with no ledger still has its topic guide.
   */
  it("returns null when there is nothing to control", async () => {
    mockFetchQuestions.mockResolvedValue([]);

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(result).toBeNull();
    expect(mockSaveTopicState).not.toHaveBeenCalled();
  });

  it("refuses a close while a topic is still unasked, naming the earliest", async () => {
    storeLedger(freshLedger());

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "close_requested", eventId: "c1" },
      db: DB,
      now: NOW,
    });

    expect(result?.closeAllowed).toBe(false);
    expect(result?.directive.topicPrompt).toBe("Describe a scaling problem you solved.");
  });

  /**
   * The worker retries a control call that timed out, so the same event id can
   * arrive twice. Re-applying it would spend a second follow-up on one answer.
   */
  it("replays a duplicate event without writing anything", async () => {
    const ledger = freshLedger();
    ledger.handledEventIds = ["t1"];
    storeLedger(ledger);

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(mockSaveTopicState).not.toHaveBeenCalled();
  });
});

describe("applyScreeningControlEvent — turn evaluation", () => {
  function openedLedger(): ScreeningTopicLedger {
    const ledger = freshLedger();
    ledger.currentTopicId = "q1";
    ledger.topics[0]!.status = "in_progress";
    ledger.topics[0]!.askedAt = NOW.toISOString();
    return ledger;
  }

  it("records the evidence summary and advances on a complete answer", async () => {
    storeLedger(openedLedger());

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: {
        type: "turn_completed",
        eventId: "turn-1",
        candidateText: "We moved onto Kafka and cut p99 from 900ms to 120ms.",
        interviewerText: "Describe a scaling problem you solved.",
      },
      db: DB,
      now: NOW,
    });

    expect(savedLedger().topics[0]?.status).toBe("complete");
    expect(savedLedger().topics[0]?.evidenceSummary).toMatch(/Kafka/);
    expect(result?.directive.topicNumber).toBe(2);
  });

  /**
   * The evaluator sees only what it needs to judge one exchange. It is not the
   * scorer and must never be handed the whole transcript — that reading happens
   * later, against the rubric, across every answer at once.
   */
  it("hands the evaluator one exchange and the topic list", async () => {
    storeLedger(openedLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: {
        type: "turn_completed",
        eventId: "turn-1",
        candidateText: "We used a queue.",
        interviewerText: "Describe a scaling problem you solved.",
      },
      db: DB,
      now: NOW,
    });

    expect(mockEvaluate).toHaveBeenCalledWith({
      currentTopic: { number: 1, prompt: "Describe a scaling problem you solved." },
      topics: [
        { number: 1, prompt: "Describe a scaling problem you solved." },
        { number: 2, prompt: "How do you decide what to test?" },
        { number: 3, prompt: "Tell me about a disagreement on a design." },
      ],
      interviewerQuestion: "Describe a scaling problem you solved.",
      candidateAnswer: "We used a queue.",
    });
  });

  /**
   * The failure most often seen here is a timeout or a rate limit, both of
   * which a second attempt usually clears — so it is worth one retry before
   * giving up on the reading altogether.
   */
  it("retries the evaluator once before falling back", async () => {
    storeLedger(openedLedger());
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockEvaluate.mockRejectedValueOnce(new Error("429 rate limited"));

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: {
        type: "turn_completed",
        eventId: "turn-1",
        candidateText: "We moved onto Kafka.",
        interviewerText: "Describe a scaling problem you solved.",
      },
      db: DB,
      now: NOW,
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(2);
    expect(result?.directive.topicNumber).toBe(2);
    expect(savedLedger().evaluatorFailures).toBe(0);
  });

  /**
   * An evaluator that stays down must not stall a live conversation. It
   * advances, and settles the topic as `complete` rather than `insufficient`:
   * the candidate did answer, our outage says nothing about what they said, and
   * a person reads this record later.
   */
  it("advances on the documented fallback when the evaluator stays down", async () => {
    storeLedger(openedLedger());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEvaluate.mockRejectedValue(new Error("connection refused"));

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: {
        type: "turn_completed",
        eventId: "turn-1",
        candidateText: "We moved onto Kafka.",
        interviewerText: "Describe a scaling problem you solved.",
      },
      db: DB,
      now: NOW,
    });

    expect(savedLedger().topics[0]?.status).toBe("complete");
    expect(savedLedger().topics[0]?.evidenceSummary).toMatch(/not evaluated/i);
    expect(savedLedger().evaluatorFailures).toBe(1);
    expect(result?.directive.topicNumber).toBe(2);
    expect(error).toHaveBeenCalled();
  });

  it("logs enough structured detail to debug an evaluator failure", async () => {
    storeLedger(openedLedger());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEvaluate.mockRejectedValue(new Error("connection refused"));

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: {
        type: "turn_completed",
        eventId: "turn-1",
        candidateText: "We moved onto Kafka.",
        interviewerText: null,
      },
      db: DB,
      now: NOW,
    });

    const logged = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(logged).toMatchObject({
      at: "screening.topic-control.evaluateTurn",
      applicationId: APP_ID,
      eventId: "turn-1",
      topicNumber: 1,
      message: "connection refused",
    });
  });
});

describe("applyScreeningControlEvent — concurrency", () => {
  /**
   * Two control events can overlap: a finalized turn and a tool call arrive on
   * separate requests. A last-write-wins update would silently drop whichever
   * transition finished second — refunding a spent follow-up, or un-asking a
   * topic.
   */
  it("re-reads and retries once when another writer got there first", async () => {
    const stored = freshLedger();
    storeLedger(stored);

    const moved = { ...freshLedger(), version: 9 };
    mockSaveTopicState.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockFetchTopicState
      .mockResolvedValueOnce({ topicState: stored as unknown as Json, status: "sent" })
      .mockResolvedValueOnce({ topicState: moved as unknown as Json, status: "sent" });

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(mockSaveTopicState).toHaveBeenCalledTimes(2);
    expect(mockSaveTopicState.mock.calls[1]?.[2]).toBe(9);
    expect(result).not.toBeNull();
  });

  /**
   * A candidate is on the phone. A lost write, a finalized response, a database
   * error — none of them may propagate as an exception, because the caller is a
   * route the interviewer is waiting on.
   */
  it("still answers with a usable directive when the write cannot land", async () => {
    storeLedger(freshLedger());
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSaveTopicState.mockRejectedValue(new Error("connection reset"));

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(result?.directive.task).toBe("ask_primary_question");
  });

  it("does not retry a write against a response that is no longer open", async () => {
    const stored = freshLedger();
    mockSaveTopicState.mockResolvedValue(false);
    mockFetchTopicState
      .mockResolvedValueOnce({ topicState: stored as unknown as Json, status: "sent" })
      .mockResolvedValueOnce({ topicState: stored as unknown as Json, status: "responded" });

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(mockSaveTopicState).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });
});

describe("applyScreeningControlEvent — separation from scoring", () => {
  /**
   * The ledger guarantees coverage and provides an audit trail. It must never
   * become an input to the score: `extractTranscriptEvidence` still reads the
   * WHOLE transcript per rubric dimension, because a candidate who evidences a
   * competency while answering some other topic has evidenced it. Narrowing
   * that would recreate the per-question bug retired on 2026-08-22.
   */
  it("never reads or writes the transcript", async () => {
    storeLedger(freshLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: {
        type: "turn_completed",
        eventId: "turn-1",
        candidateText: "We moved onto Kafka.",
        interviewerText: "Describe a scaling problem you solved.",
      },
      db: DB,
      now: NOW,
    });

    const written = savedLedger() as unknown as Record<string, unknown>;
    expect(written).not.toHaveProperty("transcript");
    expect(Object.keys(written).sort()).toEqual([
      "answerDueAt",
      "answerStartedAt",
      "currentTopicId",
      "deadlineAt",
      "evaluatorFailures",
      "handledEventIds",
      "phase",
      "rulesVersion",
      "startedAt",
      "topics",
      "unheardAnswers",
      "version",
      "wrapUpAt",
    ]);
  });

  /**
   * The stored record has to answer "was this topic actually raised, and what
   * came of it?" months later, for a person reading a decision back.
   */
  it("persists the audit fields a coverage record is read for", async () => {
    storeLedger(freshLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(savedLedger().topics[0]).toEqual({
      id: "q1",
      number: 1,
      prompt: "Describe a scaling problem you solved.",
      status: "in_progress",
      askedAt: NOW.toISOString(),
      completedAt: null,
      evidenceSummary: null,
      // How it was opened, so a wrong guess can be taken back later. The
      // interviewer asked for this one through `next_topic`, so it never can be.
      openedByStamp: false,
    });
    expect(savedLedger().rulesVersion).toBe("v4_correctable_stamp");
  });

  /**
   * The worker cannot hear WHAT the interviewer asked, so a stamp is a guess —
   * and the interviewer's own prompt tells it to probe after every answer, with
   * no tool call, so the turn being stamped is routinely a follow-up rather
   * than the next topic. The evaluator can tell the difference afterwards, but
   * only if the ledger recorded which topics were guesses.
   */
  it("records that a topic was opened by a worker stamp rather than the tool", async () => {
    storeLedger(freshLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1", stamped: true },
      db: DB,
      now: NOW,
    });

    expect(savedLedger().topics[0]?.openedByStamp).toBe(true);
  });

  /** An older worker sends no flag, and the reading that withholds a correction wins. */
  it("reads a body with no flag as the interviewer having asked for it", async () => {
    storeLedger(freshLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "topic_started", eventId: "t1" },
      db: DB,
      now: NOW,
    });

    expect(savedLedger().topics[0]?.openedByStamp).toBe(false);
  });
});

/**
 * The countdown vanished after the candidate's first answer and never came
 * back. This is the sequence that did it, driven end to end with a store that
 * compare-and-swaps the way the real `UPDATE ... WHERE topic_state->>version`
 * does — accepting every write hides the entire concurrency story.
 */
describe("a topic hand-off while the evaluator is still running", () => {
  const T0 = Date.parse("2026-08-24T10:00:00.000Z");
  let store: Json | null;

  /** Milliseconds after the call started. */
  const at = (ms: number) => new Date(T0 + ms);

  const send = (event: Parameters<typeof applyScreeningControlEvent>[0]["event"], ms: number) =>
    applyScreeningControlEvent({ applicationId: APP_ID, event, db: DB, now: at(ms) });

  beforeEach(() => {
    vi.clearAllMocks();
    store = null;
    mockFetchApp.mockResolvedValue({ campaign_id: "c1" });
    mockFetchQuestions.mockResolvedValue(QUESTIONS);
    mockFetchTopicState.mockImplementation(async () => ({ topicState: store, status: "sent" }));
    mockSaveTopicState.mockImplementation(
      async (_id: string, ledger: Json, expectedVersion: number | null) => {
        const stored =
          store && typeof store === "object" && !Array.isArray(store)
            ? ((store as Record<string, unknown>).version as number | undefined)
            : undefined;
        if (expectedVersion === null ? store !== null : stored !== expectedVersion) return false;
        store = ledger;
        return true;
      },
    );
    mockEvaluate.mockResolvedValue(evaluation());
  });

  it("keeps a clock on every question after the first", async () => {
    await send({ type: "session_started", eventId: "s", startedAt: at(0).toISOString() }, 0);
    await send({ type: "topic_started", eventId: "e1" }, 1_000);
    await send({ type: "answer_started", eventId: "e2" }, 6_000);

    // The candidate stops at +30s. `turn_completed` arrives now and holds the
    // ledger it read while the evaluator runs; `next_topic` lands half a second
    // later, which is the ordinary order rather than an edge case.
    let releaseEvaluator!: () => void;
    const running = new Promise<void>((resolve) => {
      releaseEvaluator = resolve;
    });
    mockEvaluate.mockImplementationOnce(async () => {
      await running;
      return evaluation();
    });

    const turn = send(
      {
        type: "turn_completed",
        eventId: "e3",
        candidateText: "We moved it onto Kafka.",
        interviewerText: "Tell me about scaling.",
      },
      30_000,
    );

    const raised = await send({ type: "topic_started", eventId: "e4" }, 30_500);

    // Topic 2 is genuinely raised, with a clock on it.
    expect(raised?.directive.topicNumber).toBe(2);
    expect(raised?.answerDueInMs).toBe(60_000);

    releaseEvaluator();
    const late = await turn;

    // The late verdict may annotate the topic it was about; it must not take
    // the clock down with it.
    expect(late?.answerDueInMs).not.toBeNull();

    // The candidate speaking records the onset but must NOT extend the clock:
    // topic 2 was asked at +30.5s, so at +40s it has 50.5 seconds left, not a
    // fresh 60. A counter that went back up here is the bug this asserts.
    const speaking = await send({ type: "answer_started", eventId: "e5" }, 40_000);
    expect(speaking?.answerDueInMs).toBe(50_500);
  });
});

// ─── Answers the call heard and could not save ──────────────────────────────

describe("applyScreeningControlEvent — an unheard answer", () => {
  /**
   * The whole reason this event exists. Without the count, an answer lost
   * between the microphone and the transcript scores exactly like an answer
   * never given, and the recruiter has no way to tell which they are reading.
   */
  it("records the lost answer on the ledger", async () => {
    storeLedger(freshLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "answer_unheard", eventId: "unheard-1" },
      db: DB,
      now: NOW,
    });

    expect(savedLedger().unheardAnswers).toBe(1);
  });

  /**
   * **It reports OUR failure and must never move the call.** A topic settled
   * or advanced here would write an outage of ours onto the candidate's
   * coverage record, and could cost them a question nobody then asks.
   */
  it("settles no topic and advances nothing", async () => {
    const opened = beginNextTopic(freshLedger(), NOW.toISOString(), "open").ledger;
    storeLedger(opened);

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "answer_unheard", eventId: "unheard-1" },
      db: DB,
      now: NOW,
    });

    const written = savedLedger();
    expect(written.currentTopicId).toBe(opened.currentTopicId);
    expect(written.topics.map((t) => t.status)).toEqual(opened.topics.map((t) => t.status));
    expect(written.answerDueAt).toBe(opened.answerDueAt);
  });

  /** It is a report, not a question — the interviewer carries on unchanged. */
  it("hands back the directive the call already had", async () => {
    const opened = beginNextTopic(freshLedger(), NOW.toISOString(), "open").ledger;
    storeLedger(opened);

    const result = await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "answer_unheard", eventId: "unheard-1" },
      db: DB,
      now: NOW,
    });

    expect(result?.directive).toEqual(currentDirective(opened));
  });

  /** The evaluator is never called: there is no answer to evaluate. */
  it("does not reach for the turn evaluator", async () => {
    storeLedger(freshLedger());

    await applyScreeningControlEvent({
      applicationId: APP_ID,
      event: { type: "answer_unheard", eventId: "unheard-1" },
      db: DB,
      now: NOW,
    });

    expect(mockEvaluate).not.toHaveBeenCalled();
  });
});
