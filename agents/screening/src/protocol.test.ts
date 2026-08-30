import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postControlEvent, toBackendEvent, type ControlResponse } from "./protocol.js";

const ORIGINAL_ENV = { ...process.env };

function directive(over: Partial<ControlResponse["directive"]> = {}) {
  return {
    task: "ask_primary_question" as const,
    topicNumber: 2,
    topicPrompt: "Tell me about a system you scaled.",
    remainingUnasked: 3,
    phase: "interviewing" as const,
    ...over,
  };
}

function response(over: Partial<ControlResponse> = {}): ControlResponse {
  return { directive: directive(), wrapUpInMs: 120_000, ...over };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.SCREENR_APP_ORIGIN = "https://app.test";
  process.env.AGENT_API_SECRET = "secret";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

// ─── The adapter into the state machine ─────────────────────────────────────

describe("toBackendEvent", () => {
  /**
   * The one place a control answer is allowed to become a state change, and a
   * translation rather than a decision. Every field the reducer reads is
   * decided here, so a directive it cannot use has to arrive as an error rather
   * than as a question with nothing in it.
   */
  it("carries the topic the app named", () => {
    expect(toBackendEvent(response())).toEqual({
      type: "BACKEND_RESPONSE",
      nextQuestion: "Tell me about a system you scaled.",
    });
  });

  it("says the call is over when the rubric is covered", () => {
    expect(toBackendEvent(response({ directive: directive({ task: "close" }) }))).toEqual({
      type: "BACKEND_RESPONSE",
      finish: true,
    });
  });

  /**
   * **There is nothing to do while a question is open but let them answer it.**
   * Follow-up probes are gone: a call is one question, one answer, the next
   * question. A response with neither a question nor `finish` is "nothing to
   * say yet" and is NOT an error — the reducer reads it as "keep listening".
   *
   * The failure this closes is the one it used to cause in words: the control
   * block rendering "Follow-up probes left: 2" at an interviewer whose
   * candidate had not drawn breath yet, which is an instruction to talk over
   * somebody deciding what to say.
   */
  it("distinguishes waiting for an answer from failing", () => {
    expect(toBackendEvent(response({ directive: directive({ task: "await_answer" }) }))).toEqual({
      type: "BACKEND_RESPONSE",
    });
  });

  /**
   * `ask_follow_up` is the OLD wire name for the same state. Workers deploy
   * before the app, so a new worker meets an app still sending it — and reading
   * it as anything but "wait" would have the worker either invent a probe or
   * fail a healthy call.
   */
  it("reads the old wire name for that state identically", () => {
    expect(toBackendEvent(response({ directive: directive({ task: "ask_follow_up" }) }))).toEqual({
      type: "BACKEND_RESPONSE",
    });
  });

  /**
   * **No improvisation.** This used to have a fourth outcome that handed the
   * interviewer its own numbered topic guide and told it to carry on —
   * forgiving-sounding, and the worst outcome available: the candidate holds a
   * normal-sounding conversation that evidences no rubric dimension and is
   * scored 0 on every one of them, with nothing in the record to say why.
   *
   * Failing is worse for one call and better for every candidate: the machine
   * goes to `FAILED`, says one short technical sentence, and closes the room so
   * the recruiter can re-send the link.
   */
  it("fails rather than inventing a question when the app is unreachable", () => {
    const event = toBackendEvent(null);

    expect(event.type).toBe("BACKEND_ERROR");
    expect(event).toMatchObject({ reason: expect.stringContaining("could not be reached") });
  });

  /**
   * Should be unreachable — the ledger only reports this task when a pending
   * topic exists — so reaching it means the app and this worker disagree about
   * the wire, and asking the candidate something made up is not the repair.
   */
  it("fails rather than asking an empty question", () => {
    const event = toBackendEvent(
      response({ directive: directive({ task: "ask_primary_question", topicPrompt: null }) }),
    );

    expect(event.type).toBe("BACKEND_ERROR");
  });

  /**
   * The task arrives off the wire, so it can be anything at all whatever the
   * types say. An unknown one names itself in the failure, because the whole
   * point of failing rather than improvising is that somebody can see why.
   */
  it("fails on a task this build does not know, and says which", () => {
    const event = toBackendEvent(
      response({
        directive: directive({ task: "interrogate" as ControlResponse["directive"]["task"] }),
      }),
    );

    expect(event).toEqual({
      type: "BACKEND_ERROR",
      reason: expect.stringContaining("interrogate") as unknown as string,
    });
  });
});

// ─── Transport ──────────────────────────────────────────────────────────────

describe("postControlEvent", () => {
  it("returns the parsed directive when the app answers", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          directive: directive(),
          control_block: "BLOCK",
          wrap_up_in_ms: 90_000,
          deadline_at: "2026-08-24T10:09:00.000Z",
        }),
      }),
    );

    const result = await postControlEvent("app-1", { type: "topic_started", event_id: "e1" });

    expect(result?.directive.topicPrompt).toBe("Tell me about a system you scaled.");
    expect(result?.wrapUpInMs).toBe(90_000);
  });

  /**
   * `turn_completed` and `answer_timeout` are the two events that decide the
   * next question, and the only two that run the turn evaluator. The budgets
   * themselves are asserted in timing.test.ts; this is about which event gets
   * which.
   */
  it("gives the events that decide the next question far more time", async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ directive: directive() }) }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await postControlEvent("app-1", { type: "topic_started", event_id: "e1" });
    await postControlEvent("app-1", { type: "wrap_up_due", event_id: "e2" });
    await postControlEvent("app-1", {
      type: "turn_completed",
      event_id: "e3",
      candidate_text: "We used Kafka.",
      interviewer_text: null,
    });
    await postControlEvent("app-1", { type: "answer_timeout", event_id: "e4" });

    const [quick1, quick2, slow1, slow2] = timeouts;
    expect(quick1).toBe(quick2);
    expect(slow1).toBe(slow2);
    expect(slow1).toBeGreaterThan(quick1!);
  });

  /**
   * A candidate is mid-sentence on the other end of this. Every transport
   * failure has to resolve to a value the caller can act on rather than
   * propagate — `null` is the machine's cue to stop the call cleanly.
   */
  it("degrades to null when the request times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("TimeoutError")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await postControlEvent("app-1", { type: "topic_started", event_id: "e1" })).toBeNull();
  });

  /**
   * Workers deploy before the app, so the two can legitimately be a version
   * apart. A body this build does not recognise is a rollout state, not a bug.
   */
  it("degrades to null on a response body it does not recognise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unexpected: true }) }),
    );

    expect(await postControlEvent("app-1", { type: "topic_started", event_id: "e1" })).toBeNull();
  });

  it("degrades to null without shouting when there is nothing to control", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    expect(await postControlEvent("app-1", { type: "topic_started", event_id: "e1" })).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("degrades to null when the worker is not configured to reach the app", async () => {
    delete process.env.AGENT_API_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await postControlEvent("app-1", { type: "topic_started", event_id: "e1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
