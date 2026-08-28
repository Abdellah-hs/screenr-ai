/**
 * The wire between the worker and the app, and the translation into one machine
 * event.
 *
 * **The app PUSHES the conversation; the interviewer only speaks it.** The
 * Realtime model runs with `create_response: false`, so nothing is said unless
 * the worker asks for it, and it only ever asks for the question the app's
 * directive named. This module carries that conversation and decides nothing
 * about it — what happens next is decided in machine.ts.
 */
import type { InterviewEvent } from "./machine.js";
import { controlTimeoutMs } from "./timing.js";

/**
 * The app's answer to one report: what the interviewer does next.
 *
 * Mirrors `ScreeningDirective` in src/lib/screening/topic-ledger.ts. Topics
 * travel as TEXT and never as an id, so the interviewer has no database
 * identifier it could say out loud.
 */
export interface ScreeningDirective {
  /**
   * Three states, and there is no fourth: ask the question, wait for the
   * answer, close. `ask_follow_up` is the old wire name for `await_answer`,
   * accepted so an app and a worker on either side of a rollout still
   * understand each other.
   */
  task: "ask_primary_question" | "await_answer" | "ask_follow_up" | "close";
  topicNumber: number | null;
  topicPrompt: string | null;
  remainingUnasked: number;
  phase: "interviewing" | "wrapping_up" | "finished";
}

/**
 * What the worker reads back.
 *
 * The app also sends `control_block`, `answer_due_in_ms`, `answer_running` and
 * `deadline_at` for an older worker mid-rollout. This one reads none of them,
 * and parsing a field nothing reads only invites somebody to start reading it:
 * the question arrives in the instruction attached to the turn that asks it,
 * and the answer clock is owned by the worker.
 */
export interface ControlResponse {
  directive: ScreeningDirective;
  /** Milliseconds until wrap-up; the worker arms its timer from this. */
  wrapUpInMs: number;
}

/**
 * What the worker tells the app.
 *
 * `topic_started` is a REPORT rather than a request: it is posted once the
 * question has actually been asked, so `askedAt` in the ledger is the moment
 * the candidate heard it.
 */
export type ControlEvent =
  | { type: "session_started"; event_id: string; started_at: string }
  | { type: "topic_started"; event_id: string }
  | {
      type: "turn_completed";
      event_id: string;
      candidate_text: string;
      interviewer_text: string | null;
    }
  | { type: "answer_started"; event_id: string }
  | { type: "answer_timeout"; event_id: string }
  | { type: "wrap_up_due"; event_id: string }
  /**
   * We heard them answer and never got the words.
   *
   * A REPORT about our own failure, never about the candidate, and it must not
   * be confused with `answer_timeout`: that one says nobody spoke in the time
   * allowed, this one says somebody did and the transcription sidecar returned
   * nothing. They lead to opposite readings of the same 0, which is exactly why
   * the app is told rather than left to guess from a thin transcript.
   *
   * Fire-and-forget: it decides no question and must never delay one — a
   * candidate is mid-call, and a report about a lost answer is not worth making
   * them wait.
   */
  | { type: "answer_unheard"; event_id: string };

/** The two events the candidate waits in silence for; everything else is fire-and-forget. */
function decidesNextQuestion(event: ControlEvent): boolean {
  return event.type === "turn_completed" || event.type === "answer_timeout";
}

/**
 * Post one control event and return the app's answer, or `null` if it could not
 * be reached, errored, or had nothing to control (404).
 *
 * `null` is the caller's cue to stop, never to retry in a loop or throw: a
 * candidate is mid-sentence on the other end of this.
 */
export async function postControlEvent(
  applicationId: string,
  event: ControlEvent,
): Promise<ControlResponse | null> {
  const origin = process.env.SCREENR_APP_ORIGIN;
  const secret = process.env.AGENT_API_SECRET;
  if (!origin || !secret) {
    console.error(
      "SCREENR_APP_ORIGIN / AGENT_API_SECRET not configured; running without topic control",
    );
    return null;
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${origin}/api/agent/screening/control`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ application_id: applicationId, event }),
      signal: AbortSignal.timeout(controlTimeoutMs(decidesNextQuestion(event))),
    });

    if (!res.ok) {
      // 404 is "this campaign has nothing to control", not an error worth
      // shouting about; anything else is.
      if (res.status !== 404) {
        console.error(`control ${event.type} failed (${res.status}) for ${applicationId}`);
      }
      return null;
    }

    const parsed = parseControlResponse(await res.json());
    if (parsed) {
      const d = parsed.directive;
      console.info(
        `control ${event.type} -> task=${d.task} topic=${d.topicNumber ?? "-"} ` +
          `unasked=${d.remainingUnasked} phase=${d.phase} (${Date.now() - startedAt}ms)`,
      );
    }
    return parsed;
  } catch (err) {
    console.error(
      `control ${event.type} failed for ${applicationId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Read the wire body defensively: the two packages deploy separately, so a body
 * this build does not recognise is a normal event rather than a bug.
 */
function parseControlResponse(body: unknown): ControlResponse | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const directive = data.directive as ScreeningDirective | undefined;
  if (!directive || typeof directive.task !== "string") return null;

  return {
    directive,
    wrapUpInMs: typeof data.wrap_up_in_ms === "number" ? data.wrap_up_in_ms : 0,
  };
}

/**
 * Turn one control answer into the event the state machine reduces.
 *
 * The only place a `ControlResponse` may become a state change, and a
 * translation rather than a decision. The three outcomes are distinct and must
 * not be confused: a question to ask, an ending, or "not answered yet" — which
 * carries neither a question nor `finish`, and which the reducer reads as
 * "keep listening".
 *
 * There is deliberately no fourth outcome that invents a question. An
 * unreachable app fails the call: an interviewer choosing its own questions
 * holds a normal-sounding conversation that evidences no rubric dimension, so
 * the candidate is scored 0 across the board and nothing says why.
 */
export function toBackendEvent(response: ControlResponse | null): InterviewEvent {
  if (!response) return { type: "BACKEND_ERROR", reason: "the app could not be reached" };

  const d = response.directive;
  switch (d.task) {
    case "close":
      return { type: "BACKEND_RESPONSE", finish: true };

    case "ask_primary_question":
      // A primary question with no text is not a question. It should be
      // unreachable, so reaching it means the app and this worker disagree
      // about the wire — and asking something made up is not the repair.
      return d.topicPrompt
        ? { type: "BACKEND_RESPONSE", nextQuestion: d.topicPrompt }
        : { type: "BACKEND_ERROR", reason: "the app named a topic with no question in it" };

    // A question is on the floor and there is nothing to do but let them answer
    // it. `ask_follow_up` is the old wire name for the same state.
    case "await_answer":
    case "ask_follow_up":
      return { type: "BACKEND_RESPONSE" };

    default:
      // Unreachable by the types, reachable on the wire: the app deploys
      // separately and could send anything.
      return {
        type: "BACKEND_ERROR",
        reason: `the app asked for something unknown (${String(d.task)})`,
      };
  }
}
