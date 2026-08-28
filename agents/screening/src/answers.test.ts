import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnswerAssembly, createFinalAnswerBarrier } from "./answers.js";

afterEach(() => {
  vi.useRealTimers();
});

// ─── A pause is not an ending ───────────────────────────────────────────────

describe("createAnswerAssembly", () => {
  /**
   * The whole point. Turn detection ends a turn on a beat of silence, so one
   * answer routinely arrives as three items — and under the push protocol the
   * first of them is what would ask the next question.
   */
  it("joins the fragments a paused answer arrives in", () => {
    const answers = createAnswerAssembly();

    answers.fragment(2, "We moved the ingest onto a queue,", "a");
    answers.fragment(2, "which took the p99 from four seconds to two hundred ms.", "b");

    expect(answers.take(2)?.text).toBe(
      "We moved the ingest onto a queue, which took the p99 from four seconds to two hundred ms.",
    );
  });

  /**
   * One posted event needs one id, and the app dedupes `turn_completed` on it.
   * The last fragment's is the one a retry of this post would repeat.
   */
  it("reports the last fragment's id", () => {
    const answers = createAnswerAssembly();

    answers.fragment(2, "first", "a");
    answers.fragment(2, "second", "b");

    expect(answers.take(2)?.eventId).toBe("b");
  });

  /**
   * A fragment that finishes transcribing after the call has moved on must
   * never be glued to the answer to a question the candidate had not yet heard.
   * That is the same hazard `questionSeq` guards everywhere else.
   */
  it("starts a fresh answer for a different question", () => {
    const answers = createAnswerAssembly();
    answers.fragment(2, "about the queue", "a");

    answers.fragment(3, "about the team", "b");

    expect(answers.take(3)?.text).toBe("about the team");
    // The abandoned fragment is gone with it, not waiting to be glued on later.
    expect(answers.take(2)).toBeNull();
  });

  /**
   * Everything that decides an answer is over routes through one take — the
   * settle window elapsing, and the budget running out — and they race. A
   * second take returning the same answer would report it twice.
   */
  it("hands an answer over exactly once", () => {
    const answers = createAnswerAssembly();
    answers.fragment(2, "an answer", "a");

    expect(answers.take(2)?.text).toBe("an answer");
    expect(answers.take(2)).toBeNull();
  });

  it("holds nothing for a question it has heard nothing on", () => {
    const answers = createAnswerAssembly();
    answers.fragment(2, "an answer", "a");

    expect(answers.take(3)).toBeNull();
  });

  /** An item that transcribed to nothing is not an answer and must not spend one. */
  it("ignores an empty fragment", () => {
    const answers = createAnswerAssembly();

    answers.fragment(2, "   ", "a");

    expect(answers.take(2)).toBeNull();
  });
});

// ─── The final-answer barrier ───────────────────────────────────────────────

describe("createFinalAnswerBarrier", () => {
  /**
   * Speech and transcription are two different events, and the gap between them
   * is where a whole answer can be lost: speech stopping fires when the
   * candidate stops, the finalized item lands later, and anything that closes
   * in between publishes `screening.finished` over a draft missing the last
   * thing they said. The browser submits on that packet and the server
   * finalizes from the draft, so nothing recovers it afterwards.
   */
  function harness(over: { settleMs?: number } = {}) {
    const info: string[] = [];
    const warn: string[] = [];
    let drains = 0;

    const barrier = createFinalAnswerBarrier({
      applicationId: "app-1",
      drainReports: async () => {
        drains += 1;
      },
      settleMs: over.settleMs,
      onInfo: (m) => info.push(m),
      onWarn: (m) => warn.push(m),
    });

    return { barrier, info, warn, drains: () => drains };
  }

  /** Scenario 1 — the ordinary ending. */
  it("does not release the close until the answer has landed and been drained", async () => {
    const { barrier, drains } = harness();
    barrier.speechStarted(2);

    let released = false;
    const waiting = barrier.wait("close").then((r) => {
      released = true;
      return r;
    });
    await Promise.resolve();

    expect(released).toBe(false);

    barrier.transcriptArrived(2);
    const result = await waiting;

    expect(result).toEqual({ waited: true, arrived: true });
    // Draining the REPORT chain is the point: an answer sitting in a local
    // array is not an answer the app has.
    expect(drains()).toBe(1);
  });

  /** Scenario 2 — the item is merely a little late. */
  it("includes a transcript that arrives after speech stops", async () => {
    vi.useFakeTimers();
    const { barrier } = harness();
    barrier.speechStarted(2);

    const waiting = barrier.wait("close");
    await vi.advanceTimersByTimeAsync(1200);
    barrier.transcriptArrived(2);

    await expect(waiting).resolves.toEqual({ waited: true, arrived: true });
  });

  /** Scenario 4 — nothing was heard, so nothing can be owed. */
  it("does not wait for a transcript that cannot exist", async () => {
    const { barrier, drains } = harness();

    await expect(barrier.wait("answer timeout")).resolves.toEqual({
      waited: false,
      arrived: false,
    });
    // Not even a drain: a candidate who never spoke must not add latency to a
    // close that is already correct.
    expect(drains()).toBe(0);
  });

  /**
   * Scenario 6 — the bounded backstop.
   *
   * Waiting forever is the mirror-image failure: the candidate sits on a
   * finished call, closes the tab, nothing submits, and the expiry sweep
   * rejects them for an interview they sat.
   */
  it("gives up after the backstop and says so in a way you can find later", async () => {
    vi.useFakeTimers();
    const { barrier, warn } = harness({ settleMs: 8_000 });
    barrier.speechStarted(3);

    const waiting = barrier.wait("answer timeout");
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(waiting).resolves.toEqual({ waited: true, arrived: false });

    const logged = JSON.parse(warn[0]!) as Record<string, unknown>;
    expect(logged.at).toBe("screening.worker.final_turn_unsettled");
    expect(logged.applicationId).toBe("app-1");
    expect(logged.questionSeq).toBe(3);
    // Both halves of the fact, because "we heard nothing" and "we heard them
    // and lost it" need completely different investigations.
    expect(logged.speechObserved).toBe(true);
    expect(logged.transcriptArrived).toBe(false);
  });

  /** An abandoned turn must not hold the NEXT close as well. */
  it("stops waiting on a turn it has already given up on", async () => {
    vi.useFakeTimers();
    const { barrier } = harness({ settleMs: 8_000 });
    barrier.speechStarted(3);

    const first = barrier.wait("answer timeout");
    await vi.advanceTimersByTimeAsync(8_000);
    await first;

    expect(barrier.pendingSeq()).toBeNull();
    await expect(barrier.wait("close")).resolves.toEqual({ waited: false, arrived: false });
  });

  /**
   * Scenario 5 — the sharp one, and the reason the sequence is captured at
   * SPEECH START rather than at arrival.
   *
   * A late item from a question that already timed out arrives once the next
   * question has been asked. Read at arrival, its sequence matches the current
   * one and the worker's guard waves it through — grading one answer against a
   * question the candidate had not yet heard. Read at speech start, it is
   * plainly stale.
   */
  it("attributes an answer to the question that was on the floor when they began", () => {
    const { barrier } = harness();

    barrier.speechStarted(4);
    expect(barrier.pendingSeq()).toBe(4);

    // The topic times out and question 5 is asked while their words are still
    // in transcription. An arrival claiming the new question changes nothing...
    barrier.transcriptArrived(5);
    expect(barrier.pendingSeq()).toBe(4);

    // ...and the real one settles it.
    barrier.transcriptArrived(4);
    expect(barrier.pendingSeq()).toBeNull();
  });

  it("moves on when a new answer begins before the previous one ever arrived", async () => {
    const { barrier } = harness();
    barrier.speechStarted(1);
    const abandoned = barrier.wait("close");

    // Question 2, and they start answering. The old promise must not be left
    // for a resolver that will never come.
    barrier.speechStarted(2);
    await expect(abandoned).resolves.toEqual({ waited: true, arrived: true });
    expect(barrier.pendingSeq()).toBe(2);
  });
});

/**
 * Read to decide how long to wait for MORE, so it has to count what is held
 * across every fragment rather than the latest one.
 */
describe("how much has been said so far", () => {
  it("counts nothing when nothing is held", () => {
    expect(createAnswerAssembly().wordCount(1)).toBe(0);
  });

  it("counts the words of a single fragment", () => {
    const answers = createAnswerAssembly();
    answers.fragment(1, "I don't know.", "a");

    expect(answers.wordCount(1)).toBe(3);
  });

  /**
   * Two short fragments can add up to a real answer, and must — otherwise
   * somebody answering in stops and starts is held long every single time.
   */
  it("counts across fragments", () => {
    const answers = createAnswerAssembly();
    answers.fragment(1, "We migrated the billing database", "a");
    answers.fragment(1, "over one weekend with no downtime", "b");

    expect(answers.wordCount(1)).toBe(11);
  });

  it("counts nothing for a question the call has left behind", () => {
    const answers = createAnswerAssembly();
    answers.fragment(1, "Some words here", "a");

    expect(answers.wordCount(2)).toBe(0);
  });

  it("is not confused by extra whitespace", () => {
    const answers = createAnswerAssembly();
    answers.fragment(1, "  three   little words  ", "a");

    expect(answers.wordCount(1)).toBe(3);
  });
});

// ─── Counting the answers we could not save ─────────────────────────────────

describe("createFinalAnswerBarrier — lost answers", () => {
  function harness(over: { settleMs?: number } = {}) {
    const warn: string[] = [];
    const lost: { questionSeq: number; why: string }[] = [];

    const barrier = createFinalAnswerBarrier({
      applicationId: "app-1",
      drainReports: async () => {},
      settleMs: over.settleMs,
      onInfo: () => {},
      onWarn: (m) => warn.push(m),
      onLost: (l) => lost.push(l),
    });

    return { barrier, warn, lost };
  }

  /**
   * The production failure this exists for. The candidate answered, the
   * transcription sidecar returned nothing, the interviewer thanked them and
   * asked the next question — and the transcript holds only the interviewer.
   */
  it("books a loss when the call moves on without the words ever arriving", () => {
    const { barrier, lost } = harness();

    barrier.speechStarted(1);
    barrier.speechStarted(2);

    expect(lost).toEqual([
      { questionSeq: 1, why: "the call moved on to the next question" },
    ]);
  });

  /** The ordinary call: every answer arrives, so nothing is ever booked. */
  it("books nothing when each answer's words arrive before the next question", () => {
    const { barrier, lost } = harness();

    barrier.speechStarted(1);
    barrier.transcriptArrived(1);
    barrier.speechStarted(2);
    barrier.transcriptArrived(2);

    expect(lost).toEqual([]);
    expect(barrier.lost()).toEqual([]);
  });

  /**
   * A pause mid-answer re-enters `speechStarted` on the SAME question. That is
   * one answer still in progress, not a lost one — booking it would report a
   * loss on every ordinary paused answer.
   */
  it("does not book a loss when they simply resume the same question", () => {
    const { barrier, lost } = harness();

    barrier.speechStarted(3);
    barrier.speechStarted(3);
    barrier.speechStarted(3);

    expect(lost).toEqual([]);
  });

  /** The other exit: the call ended and the words never came. */
  it("books a loss when the close gives up waiting", async () => {
    vi.useFakeTimers();
    const { barrier, lost } = harness({ settleMs: 10 });

    barrier.speechStarted(4);
    const waiting = barrier.wait("wind down");
    await vi.advanceTimersByTimeAsync(20);
    await waiting;

    expect(lost).toEqual([{ questionSeq: 4, why: "wind down" }]);
  });

  /** An answer that turns up inside the window is not a loss. */
  it("books nothing when the close's wait is satisfied", async () => {
    vi.useFakeTimers();
    const { barrier, lost } = harness({ settleMs: 50 });

    barrier.speechStarted(5);
    const waiting = barrier.wait("wind down");
    barrier.transcriptArrived(5);
    await waiting;

    expect(lost).toEqual([]);
  });

  /**
   * One loss is booked once. The close's give-up already clears `pending`, so a
   * later question must not book the same answer a second time.
   */
  it("books one loss once, even when the close and a later question both see it", async () => {
    vi.useFakeTimers();
    const { barrier } = harness({ settleMs: 10 });

    barrier.speechStarted(6);
    const waiting = barrier.wait("answer timeout");
    await vi.advanceTimersByTimeAsync(20);
    await waiting;
    barrier.speechStarted(7);

    expect(barrier.lost()).toHaveLength(1);
  });

  /**
   * Structured and carrying the application id: this is the one failure where
   * the stored record contradicts what happened, so it has to be findable
   * without reading a whole call log.
   */
  it("warns with the application id and says the words never arrived", () => {
    const { barrier, warn } = harness();

    barrier.speechStarted(1);
    barrier.speechStarted(2);

    const line = warn.map((w) => JSON.parse(w)).find((w) => w.at === "screening.worker.answer_unheard");
    expect(line).toMatchObject({
      applicationId: "app-1",
      questionSeq: 1,
      speechObserved: true,
      transcriptArrived: false,
    });
  });
});
