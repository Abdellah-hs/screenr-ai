/**
 * Screenr AI voice-screening agent worker.
 *
 * A standalone LiveKit Agents process (NOT part of the Next.js app). The app
 * opens a room per screening attempt carrying the application id in room
 * metadata; LiveKit dispatches this worker into the room, where it FETCHES its
 * interviewer instructions from the app, runs the conversation over OpenAI
 * Realtime, and reports every transcript turn back. The worker never touches
 * application state — it produces evidence (the transcript); the app's rules
 * decide everything else.
 *
 * **The app decides what is asked; this worker says it.** The Realtime model
 * runs with `create_response: false`, so OpenAI never starts a turn on its own.
 *
 * **The conversation is one finite state machine** (machine.ts). This file is
 * the two things a state machine cannot be — the ADAPTER that turns LiveKit
 * callbacks and timers into events, and the SIDE EFFECTS that speak, time and
 * report:
 *
 *   LiveKit / timers / the app  ──enqueueEvent──▶  queue ──reducer──▶ state
 *                                                              │
 *                        speech, clocks, control posts ◀──applySideEffects
 *
 * Nothing outside the reducer may change state, and the queue is drained
 * synchronously, so two callbacks can never interleave halfway through a
 * transition. Everything with state of its own lives in a module beside this
 * one: the transcript, the countdown, the timers, the speaking lane, and the
 * two helpers that decide when an answer is finished.
 *
 * The instructions are fetched rather than read off the room because LiveKit
 * delivers room metadata to every participant: while they rode in metadata, the
 * candidate's browser received the confidential topic guide on join.
 *
 * Env (see .env.example): LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 * (read by the agents CLI), OPENAI_API_KEY (Realtime), SCREENR_APP_ORIGIN +
 * AGENT_API_SECRET (fetching instructions and reporting the transcript — the
 * worker cannot run a screening without them).
 *
 * Run: `pnpm dev` (hot-reload against LiveKit Cloud) or `pnpm start`.
 */
import { type JobContext, WorkerOptions, cli, defineAgent, voice } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { createAnswerAssembly, createFinalAnswerBarrier } from "./answers.js";
import {
  SCREENING_ANSWER_TOPIC,
  SCREENING_DONE_TOPIC,
  SCREENING_FINISHED_TOPIC,
} from "./channel.js";
import { createAnswerClock } from "./clock.js";
import { createMachine, type InterviewEvent, type InterviewPhase, type InterviewState } from "./machine.js";
import {
  readCallLanguage,
  transcriptionLanguage,
  type CallLanguage,
} from "./language.js";
import {
  greetingInstructions,
  goodbyeInstructions,
  instructionForQuestion,
  technicalFailureInstructions,
} from "./prompts.js";
import { postControlEvent, toBackendEvent, type ControlResponse } from "./protocol.js";
import { createSpeaker } from "./speech.js";
import {
  ANSWER_BUDGET_MS,
  CLOSE_HOLD_MS,
  CLOSING_ANSWER_MS,
  GOODBYE_BACKSTOP_MS,
  SILENCE_NUDGE_MS,
  SPEAK_BACKSTOP_MS,
  SPEAK_HOLD_MS,
  answerHoldMs,
  answerSettleMs,
  greetingSettleMs,
  screeningVadEagerness,
} from "./timing.js";
import { createTimers } from "./timers.js";
import { createTranscript, endsOnAQuestion, interviewerTurnSince } from "./transcript.js";

/**
 * Mirrors `ScreeningRoomMetadata` in the app (src/lib/services/livekit.ts).
 *
 * **The application id, and nothing else.** LiveKit delivers room metadata to
 * every participant, so anything here is readable from the candidate's own
 * browser — which is how the confidential topic guide used to leak on join. The
 * id costs nothing to expose: their own signed token already encodes it.
 */
interface ScreeningRoomMetadata {
  application_id: string;
  /**
   * The language the candidate chose on the page before starting.
   *
   * **The second thing metadata carries, and the exception is deliberate.** The
   * rule is "the application id and nothing else", because LiveKit delivers
   * metadata to every participant — which is how the confidential topic guide
   * once leaked into the candidate's browser. This costs nothing to expose for
   * exactly the reason the id does: it came FROM that browser seconds earlier.
   * It is their own choice handed back.
   */
  language: CallLanguage | null;
}

// Must be a Realtime model the OPENAI_API_KEY can actually access. This account
// only has the GA `gpt-realtime*` family — `gpt-4o-mini-realtime-preview` is NOT
// available, and pointing here fails the session the instant it opens, leaving
// the candidate in a silent room. Verify with `GET /v1/models` before changing.
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

/**
 * The transcription sidecar, named rather than left to the plugin default.
 *
 * The default is `gpt-4o-mini-transcribe`, and it is what produces the durable
 * record: the interviewer understands the audio natively, so a call sounds
 * perfect while the TEXT the scorer reads is empty. Naming it here means a
 * plugin upgrade cannot silently change what writes that record.
 */
const TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
// "marin"/"cedar" are the natural GA voices for gpt-realtime; "alloy" et al.
// also work but sound more robotic.
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";

function parseMetadata(raw: string | undefined): ScreeningRoomMetadata | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.application_id !== "string") return null;
    // Re-checked rather than trusted: the app deploys separately, and this
    // value is written into the interviewer's own instructions.
    return { application_id: data.application_id, language: readCallLanguage(data.language) };
  } catch {
    return null;
  }
}

/**
 * Fetch this screening's interviewer instructions from the app.
 *
 * Unlike the transcript report, a failure here is fatal: there is no
 * conversation to run without them, and an interviewer improvising its own
 * questions would produce a transcript scored against a rubric it never probed
 * — every dimension at zero.
 *
 * `topics=tool` says this caller does not need the question list inline. It is
 * always withheld: the interviewer is handed each question as it is asked, and
 * with `create_response: false` it cannot start a turn to improvise one of its
 * own. The wire value is kept as `tool` so a worker and an app on either side of
 * the change still understand each other during a rollout.
 */
async function fetchInstructions(applicationId: string): Promise<string | null> {
  const origin = process.env.SCREENR_APP_ORIGIN;
  const secret = process.env.AGENT_API_SECRET;
  if (!origin || !secret) {
    console.error("SCREENR_APP_ORIGIN / AGENT_API_SECRET not configured; cannot fetch instructions");
    return null;
  }

  try {
    const url =
      `${origin}/api/agent/screening/instructions?application_id=${encodeURIComponent(applicationId)}` +
      "&topics=tool";
    const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    if (!res.ok) {
      console.error(`instructions fetch failed (${res.status}) for ${applicationId}`);
      return null;
    }
    const data = (await res.json()) as { instructions?: unknown };
    if (typeof data.instructions !== "string" || data.instructions.length === 0) {
      return null;
    }
    return data.instructions;
  } catch (err) {
    console.error("instructions fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // Only run in rooms the app created for a screening; metadata carries the
    // application id, and is set server-side only.
    const meta = parseMetadata(ctx.room.metadata);
    if (!meta || !ctx.room.name?.startsWith("screening-")) {
      console.warn(`not a screening room (${ctx.room.name}); leaving`);
      return;
    }

    const applicationId = meta.application_id;

    const instructions = await fetchInstructions(applicationId);
    if (!instructions) {
      console.error(
        `no interviewer instructions for ${applicationId} — the candidate would hear ` +
          `silence. Check SCREENR_APP_ORIGIN / AGENT_API_SECRET and that the campaign has ` +
          `screening questions.`,
      );
      throw new Error(`no instructions for application ${applicationId}`);
    }

    // Read once, so a call cannot change its mind halfway through.
    const SETTLE_MS = answerSettleMs();

    // Printed so a pasted log says which build produced it: `dev` mode does NOT
    // hot-reload, so an old process keeps its old code and model until it is
    // fully restarted — and a log from a stale worker looks exactly like a fix
    // that did not work.
    console.info(
      `screening interview starting — model=${REALTIME_MODEL} voice=${REALTIME_VOICE} ` +
        `app=${applicationId} drive=fsm settle=${SETTLE_MS}ms ` +
        `hold=${SPEAK_HOLD_MS / 1000}s/${CLOSE_HOLD_MS / 1000}s budget=${ANSWER_BUDGET_MS / 1000}s`,
    );

    const transcript = createTranscript({ applicationId });
    const timers = createTimers();
    const answers = createAnswerAssembly();
    /** The id of the fragment the current answer was taken from, for the post. */
    let answerEventId: string | null = null;
    /**
     * The language the candidate chose before starting, repeated on every
     * instruction the interviewer is given.
     *
     * Known before a word is spoken, so the greeting itself is in it. Null only
     * when an older app opened the room without one, which leaves the language
     * unpinned and restores the old behaviour of matching whatever they speak.
     */
    const callLanguage: CallLanguage | null = meta.language;

    const session = new voice.AgentSession({
      // Speech-to-speech: OpenAI Realtime handles STT, the conversation, VAD
      // and TTS in one model.
      llm: new openai.realtime.RealtimeModel({
        model: REALTIME_MODEL,
        /**
         * **The transcript is the record; this is what decides whether it has
         * anything in it.** Speech-to-speech means the interviewer never reads
         * this text — so when the sidecar fails, the call sounds completely
         * normal and the durable evidence is blank. Every rubric dimension
         * then scores `not_present`, and the 0 looks exactly like a candidate
         * who said nothing useful.
         *
         * Passing the language is the half that was missing. The candidate
         * chose it before the room existed and `speakIn` has been pinning the
         * interviewer to it on every turn, while the transcriber was still
         * auto-detecting each utterance on its own — worst on the short ones
         * this call is full of ("Oui.", "Yes.", a filler). `undefined` when
         * unpinned, which leaves auto-detection exactly as it was.
         */
        inputAudioTranscription: {
          model: TRANSCRIPTION_MODEL,
          language: transcriptionLanguage(callLanguage),
        },
        voice: REALTIME_VOICE,
        turnDetection: {
          type: "semantic_vad",
          eagerness: screeningVadEagerness(),
          // **The line the whole architecture rests on.** With
          // `create_response: true` — the plugin default — OpenAI starts a
          // reply the instant the candidate stops talking, which makes the
          // model a second interview controller alongside the state machine.
          // False, nothing speaks unless `generateReply` asks it to. Turn
          // DETECTION is untouched: the worker still knows when the candidate
          // started and finished, it simply decides what happens next.
          create_response: false,
          // **The interviewer is never cut off mid-question.**
          //
          // Barge-in used to be on, on the reasoning that somebody talking over
          // a question is answering it. On a live call it is far more often a
          // cough, a backchannel ("mm-hmm"), or somebody else in the room — and
          // the cost of reading one of those as an answer is the worst this
          // worker has: the question is CANCELLED partway through, the topic
          // has already been stamped asked, and the candidate's minute arms on
          // a question they only half heard. They then score zero on a rubric
          // dimension that was never properly put to them.
          //
          // The gain it bought was a candidate being able to skip a question
          // they had already understood. That is a convenience; the above is a
          // silent wrong answer on their file.
          //
          // **It has to be done HERE, on OpenAI's own turn detection.** The
          // framework's `allowInterruptions: false` — session-wide or per
          // `generateReply` — is silently forced back to `true` for a
          // RealtimeModel with server-side turn detection, with only a log
          // warning (agents/voice/agent_activity.ts). Setting it would look
          // like it worked and change nothing.
          //
          // Turn DETECTION is untouched: the worker still hears every word,
          // and anything said over a question still reaches the transcript the
          // scorer reads. It simply cannot cancel the question or be mistaken
          // for the answer to it — the machine keeps the floor with the agent
          // until the question has actually finished playing.
          interrupt_response: false,
        },
      }),
    });

    const agent = new voice.Agent({ instructions });

    /**
     * The candidate's countdown, published over the data channel.
     *
     * Best-effort and never awaited into anything that matters: a browser that
     * misses a packet shows a slightly stale number, which is cosmetic. The
     * interviewer moves on when this worker's timer says so regardless.
     */
    const clock = createAnswerClock({
      send: (packet) => {
        const local = ctx.room.localParticipant;
        if (!local) {
          console.warn("answer clock: no local participant to publish from");
          return;
        }
        void local
          .publishData(new TextEncoder().encode(JSON.stringify(packet)), {
            reliable: true,
            topic: SCREENING_ANSWER_TOPIC,
          })
          // Never silently: a swallowed failure here looks exactly like a
          // browser that is not listening, and the two have different fixes.
          .catch((err: unknown) =>
            console.error("answer clock publish failed:", err instanceof Error ? err.message : err),
          );
      },
    });

    const publishClock = (
      remainingMs: number | null,
      expired: boolean,
      reason: string,
      paused = false,
    ) => clock.set(remainingMs, expired, reason, paused);

    /**
     * Holds the close until an answer we HEARD has actually arrived. Speech and
     * transcription are two different events, and `screening.finished` is what
     * makes the browser submit against the draft this worker reported.
     */
    const finalAnswer = createFinalAnswerBarrier({
      applicationId,
      drainReports: () => transcript.drain(),
      /**
       * An answer we heard and could not save, told to the app as it happens.
       *
       * Fire-and-forget on purpose: this reports OUR failure, decides no
       * question, and a candidate is mid-call. `void` rather than `await` so a
       * slow control round-trip can never sit between them and the next thing
       * they are asked.
       */
      onLost: () => {
        void postControlEvent(applicationId, {
          type: "answer_unheard",
          event_id: `unheard-${randomUUID()}`,
        });
      },
    });

    const speaker = createSpeaker({
      /**
       * Ask for one turn, and claim it as uninterruptible.
       *
       * **`interrupt_response: false` is necessary and not sufficient.** It
       * stops OPENAI cancelling its own response when its VAD hears the
       * candidate. It does nothing about the FRAMEWORK, which runs its own
       * interruption on top: `onInputSpeechStarted` calls `activity.interrupt()`
       * unconditionally on every `input_speech_started` event, and that stops
       * the playout locally. So a question was still being cut off mid-sentence
       * with the OpenAI flag already off.
       *
       * The handle is the only lever that reaches it. `activity.interrupt()`
       * calls `currentSpeech.interrupt(false)`, which THROWS when the handle
       * disallows interruptions — and `onInputSpeechStarted` wraps that call in
       * a try/catch, so the throw is swallowed, the truncation below it never
       * runs, and the turn plays to its end. The framework anticipates exactly
       * this: its own comment there reads "this.interrupt() is going to raise
       * when allow_interruptions is False".
       *
       * Do NOT reach for the `allowInterruptions` OPTION instead — on the
       * session or on `generateReply`, it is silently forced back to `true` for
       * a RealtimeModel with server-side turn detection. Same word, and only
       * the setter does anything.
       *
       * The cost is one framework error line per attempt, worded as though it
       * were impossible ("this should never happen!"). It is expected here, and
       * it is the sound of a question surviving a cough.
       */
      generateReply: (text) => {
        const handle = session.generateReply({ instructions: text });
        try {
          handle.allowInterruptions = false;
        } catch {
          // The setter refuses once a handle is already interrupted. Nothing
          // left to protect, and the turn is over either way.
        }
        return handle;
      },
      backstopMs: SPEAK_BACKSTOP_MS,
      isClosed: () => machine.state.state === "DONE",
    });

    /**
     * Say one thing, and tell the machine when the turn is over.
     *
     * `ends` may be built AT that moment rather than passed ready-made: the
     * goodbye's ending depends on what the goodbye turned out to say, which is
     * not known when it is requested.
     */
    const speak = (instruction: string, why: string, ends: InterviewEvent | (() => InterviewEvent)) =>
      speaker.speak(instruction, why, () =>
        machine.enqueueEvent(typeof ends === "function" ? ends() : ends),
      );

    // ─── Talking to the app ─────────────────────────────────────────────────

    /**
     * Arm the wrap-up timer from the app's clock.
     *
     * Locally scheduled rather than waited for, because the line has to be
     * crossed DURING a long answer: a candidate three minutes into one story
     * would otherwise sail past the reserve and the remaining topics would
     * never be raised. Steering only — it never enqueues an event, so it cannot
     * interrupt the question on the floor.
     */
    const armWrapUp = (response: ControlResponse | null) => {
      if (!response || timers.has("wrapUp") || response.wrapUpInMs <= 0) return;
      timers.set("wrapUp", response.wrapUpInMs, () => {
        void postControlEvent(applicationId, {
          type: "wrap_up_due",
          event_id: `wrap-${randomUUID()}`,
        }).then(remember);
      });
    };

    /**
     * Fold one control answer into what the worker knows, without acting on it.
     * Every control post goes through here, so "reading a response" and "acting
     * on a response" stay two different things.
     */
    const remember = (response: ControlResponse | null): ControlResponse | null => {
      if (response) armWrapUp(response);
      return response;
    };

    /**
     * Post an event that decides the next question, and feed the answer to the
     * machine.
     *
     * The `seq` guard is the one race this cannot design away: the request is in
     * flight while the room carries on. Anything that came back for a question
     * the call has left behind is dropped rather than spoken.
     */
    const decideNext = (seq: number, event: Parameters<typeof postControlEvent>[1]) => {
      void postControlEvent(applicationId, event).then((result) => {
        remember(result);
        const now = machine.state;
        if (now.state !== "LISTENING" || now.questionSeq !== seq) {
          console.info(`[flow] control answer dropped — the call has moved past q${seq}`);
          return;
        }
        machine.enqueueEvent(toBackendEvent(result));
      });
    };

    // ─── Side effects ───────────────────────────────────────────────────────

    /**
     * The previous phase, so "entering X" can be told from "still in X": a
     * change within `LISTENING` (the candidate started talking) must not
     * re-speak or re-arm anything.
     */
    let lastPhase: InterviewPhase = "IDLE";

    /** Take whatever the candidate has said on this question and report it. */
    const reportAnswer = (seq: number, text: string) => {
      publishClock(null, false, "they answered");
      timers.clear("listen");
      decideNext(seq, {
        type: "turn_completed",
        event_id: answerEventId ?? `turn-${randomUUID()}`,
        candidate_text: text,
        interviewer_text: transcript.lastInterviewerText(),
      });
    };

    /**
     * Their minute ran out.
     *
     * Waits for words already SPOKEN, never for words not yet said. This is the
     * one path where a timer rather than a transcript item moves the call on, so
     * an answer finishing transcription can be outrun: they stopped a moment
     * before zero, the item is milliseconds away, and reporting a timeout over
     * it would record a topic they answered as one they did not. A candidate
     * still MID-SENTENCE at zero has nothing in flight, so that case skips the
     * barrier entirely — holding the call until they pause is exactly the grace
     * the countdown promises does not exist.
     */
    const reportTimeout = (seq: number) => {
      void (async () => {
        // They DID answer — the hold was simply still open when the minute ran
        // out. Reporting a timeout on top would settle the topic as though
        // nothing had come back, and throw away the answer in the buffer.
        const held = answers.take(seq);
        if (held) {
          timers.clear("settle");
          answerEventId = held.eventId;
          console.info("[flow] answer complete — their minute is up");
          reportAnswer(seq, held.text);
          return;
        }

        if (session.userState !== "speaking") {
          const settlement = await finalAnswer.wait("answer timeout");
          const late = settlement.arrived ? answers.take(seq) : null;
          if (late) {
            timers.clear("settle");
            answerEventId = late.eventId;
            console.info("[flow] answer landed inside the timeout — reporting it instead");
            reportAnswer(seq, late.text);
            return;
          }
        }

        // The counter is deliberately LEFT at 0:00 rather than cleared. It
        // carries the only line that explains what is about to happen — "time's
        // up, moving on to the next question" — and clearing it here would take
        // that away in the same instant it became true.
        decideNext(seq, { type: "answer_timeout", event_id: `answer-${randomUUID()}` });
      })();
    };

    /**
     * Start whatever the machine is waiting for in `LISTENING`.
     *
     * **One timer, two meanings**, so `LISTENING` always has exactly one and two
     * of them can never disagree:
     *
     *  - `budget` — a question has been asked and heard, so this is the
     *    candidate's minute, counted down on their screen, and zero moves the
     *    call on;
     *  - otherwise — the silence watchdog, with no counter, because a countdown
     *    on "can you hear me?" is both absurd and a deadline for somebody
     *    fighting a microphone permission dialog.
     *
     * `budget` is passed rather than derived, because one caller needs it false
     * on a question that HAS been delivered: the `wait` directive below, where
     * the minute has already been spent.
     */
    const armListening = (why: string, budget: boolean) => {
      publishClock(budget ? ANSWER_BUDGET_MS : null, false, why);
      timers.set("listen", budget ? ANSWER_BUDGET_MS : SILENCE_NUDGE_MS, () => {
        if (budget) publishClock(0, true, "their minute is up");
        else console.warn(`[flow] nothing has happened for ${SILENCE_NUDGE_MS / 1000}s (${why})`);
        machine.enqueueEvent({ type: "ANSWER_TIMER_EXPIRED" });
      });
    };

    /**
     * The candidate pressing "I'm done" in their browser.
     *
     * Their answer ends here rather than on a guess about a pause, which is
     * what lets the pause guess be conservative in the first place. It can only
     * ever end the sender's OWN answer early — the app decides every question
     * and the transcript is what this worker reported — so nothing it could
     * forge matters.
     */
    const finishAnswerEarly = () => {
      const now = machine.state;
      // Nothing is owed: no question on the floor, or one still being asked.
      if (now.state !== "LISTENING" || !now.questionDelivered) return;
      // A report is already in flight for this answer. Two would come back as
      // two questions, the second asked over the first.
      if (now.awaitingBackend) return;

      timers.clear("settle");
      const answer = answers.take(now.questionSeq);
      if (answer) {
        answerEventId = answer.eventId;
        console.info("[flow] answer complete — they said they were done");
        machine.enqueueEvent({ type: "TRANSCRIPT_READY", text: answer.text });
        return;
      }

      // Done with nothing held. Either they have said nothing at all, or their
      // words are still being transcribed — the timeout path waits for the
      // second case and reports the answer if it lands.
      console.info("[flow] they were done before anything was transcribed");
      machine.enqueueEvent({ type: "ANSWER_TIMER_EXPIRED" });
    };

    /** Say the question the machine is holding. */
    const askPendingQuestion = (state: InterviewState) => {
      timers.clear("hold");
      // The floor is ours now, so nothing is owed by the candidate. A watchdog
      // left running from `LISTENING` would fire into `ASKING`, where it is
      // ignored — harmless, but a timer nobody can act on is one somebody will
      // eventually make act.
      timers.clear("listen");
      const question = state.pendingQuestion;
      if (!question) return;

      // Show the minute that is coming, standing still, for the whole of the
      // asking turn. A counter that disappears while the interviewer talks is
      // absent for most of a screening call, which is how a candidate ends up
      // reporting there is no countdown at all.
      publishClock(ANSWER_BUDGET_MS, false, `asking q${state.questionSeq}`, true);
      machine.enqueueEvent({ type: "QUESTION_SENT" });
      speak(instructionForQuestion(question, callLanguage), `q${state.questionSeq}`, {
        type: "QUESTION_FINISHED",
      });

      // **Every question is a topic**, so this is unconditional. Told AFTER the
      // asking, so `askedAt` in the ledger is the moment the candidate heard the
      // question rather than the moment we decided to ask it.
      void postControlEvent(applicationId, {
        type: "topic_started",
        event_id: `topic-${randomUUID()}`,
      }).then(remember);
    };

    /** Say the goodbye, and bound it. */
    const sayGoodbye = (why: string) => {
      timers.clearAll();
      publishClock(null, false, "the interviewer is closing the call");
      // A reply that is produced but never spoken leaves no state change to
      // close on. Bounded here rather than left to the half-hour call backstop,
      // which the candidate would spend sitting on a finished interview.
      timers.set("goodbye", GOODBYE_BACKSTOP_MS, () => {
        console.warn("[clock] the goodbye never landed — closing anyway");
        machine.enqueueEvent({ type: "GOODBYE_FINISHED" });
      });

      // Before the goodbye, not after it. The goodbye is several seconds of
      // audio and would usually cover the gap on its own — but "usually" is not
      // a guarantee, and the cost of being wrong is a scored screening missing
      // the candidate's last answer.
      void finalAnswer.wait(why).then(() => {
        machine.enqueueEvent({ type: "GOODBYE_SENT" });
        // Where the transcript stands BEFORE the sign-off exists, so what comes
        // after it can only be the sign-off. Asking for "the interviewer's last
        // turn" instead reads the previous QUESTION on any run where the
        // goodbye's text has not landed yet — and a question ends in a question
        // mark by definition, so every call would hold its room open at the end.
        const before = transcript.turns().length;
        // **Read back at playout, not decided up front.** An agent turn is
        // finalized when its TEXT completes, which runs ahead of the audio — so
        // by the time this runs the goodbye is normally on the transcript and
        // can be asked whether it ended on a question. Only the model knows what
        // it said; the prompt forbidding a question here is the first half, and
        // this is the half that holds when the model ignores it.
        speak(goodbyeInstructions(callLanguage), why, () => ({
          type: "GOODBYE_FINISHED",
          askedSomething: endsOnAQuestion(interviewerTurnSince(transcript.turns(), before)),
        }));
      });
    };

    /**
     * End the call.
     *
     * The order matters and is the whole point: flush the last transcript turns
     * FIRST, then tell the browser, then leave. The browser's submit carries
     * only a token — the server finalizes from the transcript this worker
     * reported — so signalling before the flush would race the candidate's
     * submit against their own last answer.
     */
    const windDown = () => {
      timers.clearAll();
      void (async () => {
        // The backstop, not the mechanism: callers hold the barrier before they
        // decide to close. This catches the paths that reach here another way —
        // a goodbye backstop firing, a `generateReply` that threw.
        await finalAnswer.wait("wind down");
        try {
          await transcript.flush();
          await ctx.room.localParticipant?.publishData(
            new TextEncoder().encode(JSON.stringify({ at: new Date().toISOString() })),
            { reliable: true, topic: SCREENING_FINISHED_TOPIC },
          );
          publishClock(null, false, "call finished");
          console.info(`interview complete for ${applicationId}; candidate notified`);
        } catch (err) {
          console.error("wind-down failed:", err instanceof Error ? err.message : err);
        }

        // A moment for the reliable packet to leave before the room closes.
        // Without it the candidate can be disconnected before they are told why,
        // which lands them on "start over" with a finished interview behind them.
        setTimeout(() => {
          void session.close().catch(() => undefined);
        }, 1500);
      })();
    };

    /**
     * Everything the machine's transitions actually DO.
     *
     * Called synchronously by the queue, once per state change, with the state
     * as it now is and the event that produced it. It starts asynchronous work
     * and returns immediately; every result comes back as a fresh event, which
     * is what keeps the reducer the only thing that decides anything.
     */
    const applySideEffects = (state: InterviewState, event: InterviewEvent) => {
      // ── Bookkeeping keyed on the event, whatever state it landed in ────────
      if (event.type === "CANDIDATE_SPEECH_STARTED") {
        // They were not finished. The turn that looked like an ending was one
        // clause of an answer, so drop the pending report and wait for the rest
        // — the next fragment re-arms the window.
        if (timers.has("settle")) {
          console.info("[clock] still answering — that pause was not the end");
          timers.clear("settle");
        }
        // An answer is now owed to us, and the question it answers is the one on
        // the floor NOW, not whichever is current by the time the words come
        // back from transcription. `FINISHING` is included because the clock is
        // stopped for the close, and a candidate talking over the sign-off is
        // the one case that actually lost words on a live call.
        if (state.questionDelivered || state.state === "FINISHING") {
          finalAnswer.speechStarted(state.questionSeq);
        }
        // Recorded as evidence on the transcript — how long somebody took to
        // start is worth having. It moves nothing.
        if (state.questionDelivered) {
          void postControlEvent(applicationId, {
            type: "answer_started",
            event_id: `speech-${randomUUID()}`,
          }).then(remember);
        }
      }

      // ── Entering a state ──────────────────────────────────────────────────
      const entering = state.state !== lastPhase;
      lastPhase = state.state;

      if (entering) {
        switch (state.state) {
          case "GREETING":
            // The greeting asks the audio check and NOTHING else, then stops.
            // Topic 1 belongs to the turn after the candidate has spoken.
            machine.enqueueEvent({ type: "GREETING_SENT" });
            speak(greetingInstructions(callLanguage), "greeting", { type: "GREETING_FINISHED" });
            return;

          case "ASKING":
            askPendingQuestion(state);
            return;

          case "LISTENING":
            armListening(
              event.type === "GREETING_FINISHED" ? "greeting" : "listening",
              state.questionDelivered,
            );
            return;

          case "FINISHING":
            sayGoodbye("close");
            return;

          case "FAILED":
            // **No improvisation.** The app could not say what to ask, so the
            // call stops rather than inventing questions that would evidence no
            // rubric dimension and score the candidate 0 across the board.
            console.error(`[fsm] interview failed for ${applicationId}: ${state.failure}`);
            timers.clearAll();
            publishClock(null, false, "the call could not continue");
            timers.set("goodbye", GOODBYE_BACKSTOP_MS, () => {
              machine.enqueueEvent({ type: "GOODBYE_FINISHED" });
            });
            machine.enqueueEvent({ type: "GOODBYE_SENT" });
            speak(technicalFailureInstructions(callLanguage), "technical failure", {
              type: "GOODBYE_FINISHED",
            });
            return;

          case "DONE":
            windDown();
            return;

          default:
            return;
        }
      }

      // ── Staying put ───────────────────────────────────────────────────────
      switch (state.state) {
        case "LISTENING":
          if (state.pendingQuestion || state.pendingClose) {
            // Something the interviewer wants to say is waiting for the
            // candidate to pause — the next question, or the goodbye.
            //
            // **Keyed on something being held rather than on the event that
            // decided it**, because several events can leave one held: a backend
            // answer arriving mid-sentence, the opening question landing on
            // somebody still answering the audio check, and the close landing
            // while they are still finishing their last answer.
            //
            // The interviewer never starts a turn over them — with barge-in on,
            // speaking across somebody gets the turn cancelled partway through,
            // and on the goodbye that means the room shuts on a cancelled
            // sign-off while they are still mid-sentence. Bounded, because a
            // candidate who does not stop cannot hold the room open forever:
            // they close the tab, nothing submits, and the expiry sweep rejects
            // them for a call they actually sat.
            if (timers.has("hold")) return;
            // The goodbye waits longer, because nothing is waiting on IT.
            const bound = state.pendingClose ? CLOSE_HOLD_MS : SPEAK_HOLD_MS;
            const held = state.pendingClose ? "goodbye" : "next question";
            console.info(`[flow] holding the ${held} — they are still talking`);
            timers.set("hold", bound, () => {
              console.warn(
                `[flow] they are still talking after ${bound / 1000}s — carrying on (${held})`,
              );
              machine.enqueueEvent({ type: "CANDIDATE_SPEECH_STOPPED" });
            });
            return;
          }
          if (event.type === "TRANSCRIPT_READY" && state.awaitingBackend) {
            reportAnswer(state.questionSeq, event.text);
            return;
          }
          if (event.type === "ANSWER_TIMER_EXPIRED" && state.awaitingBackend) {
            reportTimeout(state.questionSeq);
            return;
          }
          if (event.type === "BACKEND_RESPONSE") {
            // Nothing is held (the branch above would have caught it), so this
            // is the app saying the question on the floor has not been answered
            // yet. Saying something would talk over somebody deciding how to
            // answer, so just keep watching.
            //
            // **The watchdog, not a fresh minute.** Their budget was spent and
            // taken off the screen when their answer was reported; re-arming it
            // here would let one question accrue two, three, four minutes with
            // the countdown restarting each time.
            armListening("waiting on an answer", false);
            return;
          }
          return;

        case "FINISHING":
          if (event.type === "GOODBYE_FINISHED") {
            // The only way to stay in `FINISHING` past the sign-off: it asked
            // something, or they are still talking. Hold the room open rather
            // than submitting over them.
            console.info(
              state.candidateSpeaking
                ? "[flow] they are still talking — not closing over them"
                : "[flow] the goodbye ended on a question — waiting for their answer",
            );
            timers.set("closing", CLOSING_ANSWER_MS, () =>
              machine.enqueueEvent({ type: "CLOSING_WINDOW_ELAPSED" }),
            );
            return;
          }
          if (event.type === "CLOSING_WINDOW_ELAPSED") {
            // Still answering when the wait ran out. One more bounded window,
            // then the room closes whatever is happening — a call nobody can
            // end is worse than a sentence cut short, because nothing submits
            // when the candidate gives up and closes the tab.
            console.info("[flow] still answering the closing question — one more wait");
            timers.set("closing", CLOSE_HOLD_MS, () =>
              machine.enqueueEvent({ type: "CLOSING_WINDOW_ELAPSED" }),
            );
          }
          return;

        default:
          return;
      }
    };

    const machine = createMachine({ applySideEffects });

    // ─── Session events become machine events ───────────────────────────────
    //
    // Every handler below does the same two things: record whatever only it can
    // observe, and enqueue an event. **None of them changes state**, which is
    // what makes their concurrency harmless.

    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === "speaking") {
        console.info("[clock] candidate started speaking");
        machine.enqueueEvent({ type: "CANDIDATE_SPEECH_STARTED" });
        return;
      }
      if (ev.oldState !== "speaking") return;
      console.info("[clock] candidate stopped speaking");
      machine.enqueueEvent({ type: "CANDIDATE_SPEECH_STOPPED" });
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "speaking") {
        console.info("[clock] interviewer started speaking");
        return;
      }
      if (ev.oldState !== "speaking") return;
      console.info("[clock] interviewer finished speaking");
      // **The turn is over, and it ends with the event `speak` bound to it** — a
      // greeting ends the greeting, a question ends a question — so this handler
      // never has to work out which kind of turn just stopped. It is idempotent
      // against the reply resolving at the same moment, which it routinely does.
      speaker.endCurrentTurn();
    });

    // Every finalized conversation item (agent or candidate) becomes one
    // transcript turn, stamped server-side — the browser never supplies these.
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (!("role" in item)) return;
      const text = item.textContent?.trim();
      if (!text) return;

      const role = item.role === "assistant" ? "agent" : "candidate";

      // `item.id` is the Realtime item id and is stable across a redelivery,
      // which is what makes the app's idempotency check work — and what lets us
      // drop a redelivery here.
      const eventId = item.id ?? `turn-${randomUUID()}`;
      if (!transcript.add(role, text, eventId)) {
        console.info(`[flow] duplicate transcript item ignored (${role})`);
        return;
      }

      if (role === "agent") return;

      // The question this answers is the one that was on the floor when they
      // STARTED speaking. Reading the sequence HERE instead was a real hole: a
      // late item from a question that had already timed out arrives once the
      // next question has been asked, at which point the arrival-time sequence
      // matches the current one and the guard below waves it through — grading
      // one answer against a question the candidate had not yet heard.
      const seq = finalAnswer.pendingSeq() ?? machine.state.questionSeq;
      finalAnswer.transcriptArrived(seq);

      const now = machine.state;
      // Recorded, but not acted on: the call is closing, or this belongs to a
      // question it has already left behind.
      if (now.state !== "LISTENING" || seq !== now.questionSeq) return;

      // Hold it. If they start again inside the window it was one answer all
      // along — `answers` joins the fragments and nothing was spent.
      answers.fragment(seq, text, eventId);
      timers.clear("settle");
      const flush = () => {
        const answer = answers.take(seq);
        // Already taken by the timeout path, which reports it itself.
        if (!answer) return;
        answerEventId = answer.eventId;
        console.info("[flow] answer complete — the pause was the ending");
        machine.enqueueEvent({ type: "TRANSCRIPT_READY", text: answer.text });
      };
      // **How long to wait for more depends on how little they have said.**
      //
      //  - the audio check gets a SHORT hold: "can you hear me?" is answered in
      //    one word, so the window an interview answer needs is pure dead air at
      //    the top of the call, where a silent screen reads as a broken one. Not
      //    removed, because "yes —" and a continuation must not be asked over.
      //  - a barely-there answer gets a LONG one: three words and a pause is
      //    somebody thinking, not somebody finished, and settling there spends
      //    their topic with most of their minute still on the screen.
      //  - a real answer keeps the ordinary window.
      //
      // Their minute runs throughout either way — the budget timer is untouched
      // — so a long wait cannot outlive the countdown they can see.
      const hold =
        seq === 0
          ? greetingSettleMs(SETTLE_MS)
          : answerHoldMs(answers.wordCount(seq), SETTLE_MS);
      if (hold === null) {
        // Too little said to call it an ending. Their countdown carries it —
        // the budget flushes whatever is held — and the Done button is how
        // somebody who really has finished skips the wait.
        console.info("[flow] barely a few words — letting their clock run");
        return;
      }
      if (hold <= 0) flush();
      else timers.set("settle", hold, flush);
    });

    // The one packet that travels browser -> worker. Typed by the room's own
    // event map, so the handler shape cannot drift from the SDK's.
    ctx.room.on("dataReceived", (_payload, _participant, _kind, topic) => {
      if (topic !== SCREENING_DONE_TOPIC) return;
      finishAnswerEarly();
    });

    // Final flush when the job winds down (candidate left / room closed).
    ctx.addShutdownCallback(async () => {
      timers.clearAll();
      clock.stop();
      await transcript.drain();
      await speaker.drain();
      await transcript.flush();
    });

    // If the Realtime session can't open (e.g. a model the key can't access),
    // the candidate would otherwise just sit in a silent room. Fail loudly here
    // with the model name so the cause is obvious in the worker logs.
    try {
      // Opening the ledger does not depend on the session, so it rides alongside
      // rather than behind it. Serialized, its app round-trip landed between the
      // room connecting and the first word — silence at the top of every call,
      // on a screen where looking frozen is what makes candidates close the tab.
      const opened = postControlEvent(applicationId, {
        type: "session_started",
        event_id: `session-${randomUUID()}`,
        started_at: new Date().toISOString(),
      });

      await session.start({ agent, room: ctx.room });

      // IDLE -> GREETING. Everything from here is the machine's.
      machine.enqueueEvent({ type: "SESSION_CONNECTED" });

      // The opening directive names topic 1, which the machine HOLDS while the
      // greeting plays and asks once the candidate has answered the audio check.
      // A failure here is a failure of the whole call — there is no question to
      // ask and inventing one is forbidden — so it goes in as a backend answer
      // like any other.
      void opened.then((result) => machine.enqueueEvent(toBackendEvent(remember(result))));
    } catch (err) {
      console.error(
        `Realtime session failed to start (model=${REALTIME_MODEL}, voice=${REALTIME_VOICE}) — ` +
          `the candidate will hear silence. Verify the model is accessible to OPENAI_API_KEY.`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  },
});

/**
 * Named worker => EXPLICIT dispatch: this worker is summoned by name from
 * `createScreeningRoomGrant`, and only into screening rooms.
 *
 * An unnamed worker is dispatched automatically into EVERY room in the LiveKit
 * project, including the video-interview rooms — where it would take one of the
 * two participant slots away from the real interviewer before noticing the room
 * prefix and leaving. Restart this worker after changing the name, or screenings
 * get no agent.
 *
 * Must stay in sync with SCREENING_AGENT_NAME in src/lib/services/livekit.ts.
 */
export const SCREENING_AGENT_NAME = "screenr-screening";

/**
 * How long a forked job process has to become ready before the job is dropped.
 *
 * **This bounds `await import()` of this very file**, in a fresh child process:
 * the framework forks, the child imports the agent module, and only then
 * answers the parent's `initializeRequest`. `prewarm` is a no-op here, so the
 * entire budget is module loading — and `@livekit/agents` pulls in
 * `@livekit/rtc-node` and its native bindings behind it.
 *
 * The default is 10s, which is generous for a warm file cache (measured: ~2.4s
 * for the whole graph) and nowhere near enough for a cold one (measured: 22s on
 * this machine, where the repository lives under OneDrive and every file open
 * goes through a sync filter driver before Defender sees it). Cold is exactly
 * the case that matters: it is the first screening after the worker starts.
 *
 * The failure it produces says nothing about any of that — `runner
 * initialization timed out`, and the candidate sits in a room no agent ever
 * joins.
 *
 * It costs nothing when things are healthy: it is a bound on a failure, not a
 * delay anybody waits out. The real fix for the 20 seconds is not to pay them
 * while a candidate is waiting — see `numIdleProcesses` below.
 */
const INITIALIZE_PROCESS_TIMEOUT_MS = 60_000;

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: SCREENING_AGENT_NAME,
    initializeProcessTimeout: INITIALIZE_PROCESS_TIMEOUT_MS,
    /**
     * How many job processes are forked and imported UP FRONT.
     *
     * Deliberately left at the framework's default, which is 0 in `dev` and
     * `min(cpus, 4)` in `start`. So in dev the cold import above happens after
     * the candidate has already joined, and they wait in a silent room for it;
     * in production it happens at worker boot, with nobody waiting.
     *
     * That difference is worth knowing rather than papering over: a slow first
     * call in `pnpm dev` is the machine, not the code, and pinning a number
     * here would cap production's warm pool at whatever suits a laptop.
     */
  }),
);
