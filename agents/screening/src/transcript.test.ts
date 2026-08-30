import { describe, expect, it } from "vitest";
import {
  createTranscript,
  endsOnAQuestion,
  interviewerTurnSince,
  type TranscriptTurn,
} from "./transcript.js";

/** A transcript whose reports are captured rather than sent. */
function harness(options: { block?: boolean } = {}) {
  const sent: TranscriptTurn[][] = [];
  let unblock: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });

  const transcript = createTranscript({
    applicationId: "app-1",
    send: async (_id, turns) => {
      sent.push(turns);
      // Holds the FIRST report open, to prove the second queues behind it.
      if (options.block && sent.length === 1) await blocked;
    },
    now: () => new Date("2026-08-27T10:00:00.000Z"),
  });

  return { transcript, sent, unblock };
}

/** Let every already-queued microtask run. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("createTranscript", () => {
  /**
   * The durable record of a screening is the transcript, and the browser
   * submits against the draft this worker reported — so a turn that never
   * reaches the app is an answer nobody scores. Reported after every turn
   * rather than once at the end, so a crash loses at most the final turn.
   */
  it("reports the whole transcript after every turn", async () => {
    const { transcript, sent } = harness();

    transcript.add("agent", "Tell me about Kafka.", "i1");
    transcript.add("candidate", "We ran three brokers.", "i2");
    await transcript.drain();

    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([
      { role: "agent", text: "Tell me about Kafka.", at: "2026-08-27T10:00:00.000Z" },
      { role: "candidate", text: "We ran three brokers.", at: "2026-08-27T10:00:00.000Z" },
    ]);
  });

  /**
   * LiveKit may redeliver a conversation item. The app is idempotent on the
   * event id, but the turn list is not — a duplicate would show the answer
   * twice in the transcript the scorer reads.
   */
  it("folds a redelivered item in exactly once", async () => {
    const { transcript, sent } = harness();

    expect(transcript.add("candidate", "We ran three brokers.", "i1")).toBe(true);
    expect(transcript.add("candidate", "We ran three brokers.", "i1")).toBe(false);
    await transcript.drain();

    expect(transcript.turns()).toHaveLength(1);
    // ...and the duplicate did not queue a second report either.
    expect(sent).toHaveLength(1);
  });

  /**
   * Two overwrites of the same draft must not land out of order, or the app is
   * left holding the older one — which on a fast exchange is a transcript
   * missing its last answer.
   */
  it("serializes reports so a fast exchange cannot land out of order", async () => {
    const { transcript, sent, unblock } = harness({ block: true });

    transcript.add("agent", "one", "i1");
    transcript.add("candidate", "two", "i2");
    await settle();

    // The second report cannot start while the first is still in flight.
    expect(sent).toHaveLength(1);

    unblock();
    await transcript.drain();

    // ...and when it does, it carries both turns, in order.
    expect(sent).toHaveLength(2);
    expect(sent[1]!.map((turn) => turn.text)).toEqual(["one", "two"]);
  });

  /** The control report names the question the candidate was answering. */
  it("knows the interviewer's most recent turn", () => {
    const { transcript } = harness();

    transcript.add("agent", "First question.", "i1");
    transcript.add("candidate", "An answer.", "i2");
    transcript.add("agent", "Second question.", "i3");
    transcript.add("candidate", "Another answer.", "i4");

    expect(transcript.lastInterviewerText()).toBe("Second question.");
  });

  it("has no interviewer turn to name before one has been spoken", () => {
    const { transcript } = harness();

    expect(transcript.lastInterviewerText()).toBeNull();
  });

  /**
   * The final flush is what the wind-down waits on before telling the browser
   * to submit, so it must send the complete transcript and not merely whatever
   * was queued.
   */
  it("sends everything once more when flushed", async () => {
    const { transcript, sent } = harness();
    transcript.add("candidate", "the last thing they said", "i1");

    await transcript.flush();

    expect(sent).toHaveLength(2);
    expect(sent.at(-1)).toEqual([
      { role: "candidate", text: "the last thing they said", at: "2026-08-27T10:00:00.000Z" },
    ]);
  });

  /** Callers must not be able to reach in and edit what has been recorded. */
  it("hands out a copy rather than the list it is keeping", () => {
    const { transcript } = harness();
    transcript.add("candidate", "an answer", "i1");

    transcript.turns().push({ role: "agent", text: "forged", at: "now" });

    expect(transcript.turns()).toHaveLength(1);
  });
});

/**
 * The reading that decides whether a finished call may actually close.
 *
 * The interviewer is told its sign-off must end in a statement, and sometimes
 * ends it with "anything you'd like to add?" instead. The room closes on that
 * turn and the browser submits when it does, so getting this wrong in the
 * permissive direction hangs up on a real answer.
 */
describe("endsOnAQuestion", () => {
  it("is false for an ordinary sign-off", () => {
    expect(
      endsOnAQuestion("Thanks so much for your time — the hiring team will follow up by email."),
    ).toBe(false);
  });

  it("is true for the two the interviewer actually asks", () => {
    expect(endsOnAQuestion("Thanks for your time. Do you have any questions for me?")).toBe(true);
    expect(endsOnAQuestion("Before we wrap up, is there anything you'd like to add?")).toBe(true);
  });

  /**
   * The call settles into whatever language the candidate answered in, so an
   * ASCII-only check would hold for an English call and quietly fail for every
   * Arabic one — where the cost is identical.
   */
  it("reads a question mark in the language the call is actually in", () => {
    expect(endsOnAQuestion("شكرا لوقتك. هل لديك أي أسئلة؟")).toBe(true);
    expect(endsOnAQuestion("Merci beaucoup. Avez-vous des questions ?")).toBe(true);
  });

  it("sees the mark through a closing quote or bracket", () => {
    expect(endsOnAQuestion('And you said "is that all?"')).toBe(true);
    expect(endsOnAQuestion("Thanks again.  ")).toBe(false);
  });

  /**
   * **A question mark, and nothing cleverer.** An open question is routinely an
   * imperative — the interviewer is told to ask that way — so anything that
   * tried to read intent would fire on half the questions on the call. This is
   * only ever read in the direction of waiting longer, so a miss costs seconds
   * of dead air and a false negative costs somebody their answer.
   */
  it("does not try to guess at an imperative", () => {
    expect(endsOnAQuestion("Tell me about a time you disagreed with a colleague.")).toBe(false);
  });

  it("is false when there is no interviewer turn to read", () => {
    expect(endsOnAQuestion(null)).toBe(false);
    expect(endsOnAQuestion("   ")).toBe(false);
  });
});

/**
 * The close reads the goodbye's own words. Reading "the interviewer's last
 * turn" instead is wrong by a hair of timing, and the hair costs every call
 * twenty seconds.
 */
describe("interviewerTurnSince", () => {
  const turn = (role: TranscriptTurn["role"], text: string): TranscriptTurn => ({
    role,
    text,
    at: "2026-08-27T19:35:00.000Z",
  });

  /** A real call: the last question, its answer, then the sign-off. */
  const call = [
    turn("agent", "What drew you to this role?"),
    turn("candidate", "The scale of the data, mostly."),
    turn("agent", "Thanks so much for your time — the team will follow up by email."),
  ];

  it("reads the sign-off rather than the question before it", () => {
    expect(interviewerTurnSince(call, 2)).toBe(
      "Thanks so much for your time — the team will follow up by email.",
    );
  });

  /**
   * The goodbye's text had not landed when its playout ended. Nothing after the
   * snapshot means nothing can be read, and the close proceeds — rather than
   * reading the QUESTION, which ends in a question mark by definition and would
   * hold the room open at the end of every single call.
   */
  it("is null when the sign-off has not been recorded yet", () => {
    const unfinished = call.slice(0, 2);

    expect(interviewerTurnSince(unfinished, 2)).toBeNull();
    expect(endsOnAQuestion(interviewerTurnSince(unfinished, 2))).toBe(false);
  });

  it("never reaches back past the snapshot", () => {
    // The whole transcript is there, but only what came after index 2 counts.
    expect(interviewerTurnSince(call, 3)).toBeNull();
  });

  it("skips the candidate's own turns", () => {
    const answered = [...call, turn("candidate", "Great, thank you!")];

    expect(interviewerTurnSince(answered, 2)).toBe(
      "Thanks so much for your time — the team will follow up by email.",
    );
  });

  /** The redelivered sign-off is the one that counts, not the cut-off first. */
  it("takes the most recent interviewer turn when there are two", () => {
    const redelivered = [...call, turn("agent", "Take care, and thanks again.")];

    expect(interviewerTurnSince(redelivered, 2)).toBe("Take care, and thanks again.");
  });
});

/**
 * What happens to the record when reporting it fails.
 *
 * `reportTranscript` swallows its own errors today, so these guard an
 * invariant that currently holds by accident — it lives in a distant function
 * rather than in the queue. `speech.ts` keeps the same guarantee local to its
 * own lane (`lane.catch`, plus a try/finally around every turn); this is the
 * matching pair for the transcript's.
 */
describe("createTranscript when a report fails", () => {
  /**
   * A rejected send must not poison the lane every later report queues behind.
   * `.then` skips its handler on an already-rejected promise, so ONE failure
   * would mean no further turn is ever reported for the rest of the call —
   * and the transcript is what the score is read from.
   */
  it("keeps reporting after a send fails", async () => {
    const sent: string[][] = [];
    const transcript = createTranscript({
      applicationId: "app-1",
      send: async (_id, turns) => {
        sent.push(turns.map((turn) => turn.text));
        if (sent.length === 1) throw new Error("network down");
      },
    });

    transcript.add("agent", "one", "i1");
    transcript.add("candidate", "two", "i2");
    await transcript.drain();

    expect(sent).toEqual([["one"], ["one", "two"]]);
  });

  /** A poisoned lane must not surface as a throw at the shutdown callback. */
  it("drains without throwing after a send fails", async () => {
    const transcript = createTranscript({
      applicationId: "app-1",
      send: async () => {
        throw new Error("network down");
      },
    });
    transcript.add("candidate", "an answer", "i1");

    await expect(transcript.drain()).resolves.toBeUndefined();
  });

  /**
   * `windDown` flushes and THEN publishes `screening.finished` — the packet the
   * browser submits on — inside one try block. A throwing flush skips the
   * publish, so the candidate is never told to submit: they sit on a finished
   * call at `screening_sent` until the expiry sweep rejects them for an
   * interview they actually sat. An incomplete transcript is worth submitting;
   * a complete one nobody submits is not.
   */
  it("does not throw out of flush when the report fails", async () => {
    const transcript = createTranscript({
      applicationId: "app-1",
      send: async () => {
        throw new Error("network down");
      },
    });
    transcript.add("candidate", "the last thing they said", "i1");

    await expect(transcript.flush()).resolves.toBeUndefined();
  });
});
