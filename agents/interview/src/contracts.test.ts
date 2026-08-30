/**
 * The facts about `agent.ts` that can only be checked by reading it.
 *
 * Everything testable as behaviour is tested as behaviour elsewhere. What is
 * left here is one plugin configuration object passed to a LiveKit constructor
 * and one listener registration — neither reachable without a live room, and
 * both silent when wrong: the interviewer keeps talking either way, and the
 * damage only shows up in a transcript nobody reads until the candidate has
 * already been scored on it.
 *
 * A `toContain` on source passes if the string appears in a COMMENT, so each
 * assertion below is anchored on code that could not plausibly be prose.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const WORKER = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

describe("the candidate cannot cut off a question", () => {
  /**
   * **It takes BOTH of these**, and they stop two different parties doing the
   * same thing:
   *
   *  - `interrupt_response: false` stops OPENAI cancelling its own response
   *    when its server-side VAD hears the candidate;
   *  - `handle.allowInterruptions = false` stops the FRAMEWORK, which runs its
   *    own interruption on top — `onInputSpeechStarted` calls
   *    `activity.interrupt()` unconditionally, and the only thing that stops it
   *    is `currentSpeech.interrupt(false)` throwing, which that caller catches.
   *
   * On the screening worker the first was shipped alone and questions were
   * still being cut off.
   */
  it("blocks interruption on both sides", () => {
    const assignments = WORKER.match(/^\s*interrupt_response: .+,$/gm) ?? [];

    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.trim()).toBe("interrupt_response: false,");
    expect(WORKER).toContain("ev.speechHandle.allowInterruptions = false;");
  });

  /**
   * **The option and the setter share a name and only the setter works.**
   *
   * `allowInterruptions` passed to the session or to `generateReply` is
   * silently forced back to `true` for a RealtimeModel with server-side turn
   * detection, with nothing but a log warning — so passing it reads as a
   * guarantee and provides none. Asserted on the property-assignment form, so
   * the prose explaining the trap stays free to name it.
   */
  it("never passes the interruption option that does nothing", () => {
    expect(WORKER).not.toMatch(/^\s*allowInterruptions:/m);
  });

  /**
   * The handle has to be claimed on `SpeechCreated`, not on the greeting's
   * return value.
   *
   * This interviewer starts its own turns, so all but one of its speech handles
   * are created inside the framework and never surface to the caller. Claiming
   * only what `generateReply` hands back would protect the greeting and leave
   * every question after it interruptible — which is every question that
   * matters.
   */
  it("claims handles the framework creates, not just the one it is handed", () => {
    expect(WORKER).toContain("voice.AgentSessionEventTypes.SpeechCreated");
  });

  /**
   * Registration has to precede `session.start`, or the first turn is created
   * before anything is listening and the greeting goes out interruptible.
   */
  it("registers the listener before the session starts", () => {
    const listener = WORKER.indexOf("voice.AgentSessionEventTypes.SpeechCreated");
    const start = WORKER.indexOf("await session.start(");

    expect(listener).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);
    expect(listener).toBeLessThan(start);
  });
});

describe("the model still drives this conversation", () => {
  /**
   * **`create_response` is TRUE here, and that is the difference from
   * screening.**
   *
   * The screening worker sets it false because the app decides every question
   * and pushes it; nothing pushes this one. The interviewer improvises from the
   * candidate's CV, so if it is not allowed to start a turn, it says its
   * greeting and never speaks again — the candidate sits in a silent room for
   * ten minutes and the transcript holds one line.
   *
   * The two workers' turn-detection blocks otherwise look alike, which is
   * exactly why copying one into the other is a plausible mistake and why this
   * is pinned rather than left to review.
   */
  it("lets the interviewer start its own turns", () => {
    const assignments = WORKER.match(/^\s*create_response: .+,$/gm) ?? [];

    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.trim()).toBe("create_response: true,");
  });
});
