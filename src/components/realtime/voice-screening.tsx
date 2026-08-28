"use client";

import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteParticipant,
} from "livekit-client";
import {
  startCandidateVoiceScreening,
  submitVoiceScreening,
} from "@/lib/actions/respond";
import {
  AGENT_JOIN_TIMEOUT_MS,
  diagnoseAgentSilence,
  realtimeTrace,
} from "@/lib/realtime/interview-diagnostics";
import { createProctoringCollector } from "@/lib/proctoring/collector";
import {
  CALL_LANGUAGES,
  CALL_LANGUAGE_LABELS,
  DEFAULT_CALL_LANGUAGE,
  SCREENING_CALL_BACKSTOP_MINUTES,
  type CallLanguage,
} from "@/lib/constants";
import {
  Assurance,
  Body,
  CandidateShell,
  Deadline,
  formatClock,
  Heading,
  Icon,
  ShellIcon,
  SHELL_PRIMARY,
  SHELL_SECONDARY,
  type ShellTone,
} from "@/components/candidate/candidate-shell";
import { cn } from "@/lib/utils";

interface VoiceScreeningProps {
  token: string;
  campaignTitle: string;
  /**
   * How many questions the campaign asks. Quoted before the candidate starts,
   * because it is the one thing about the call's shape that is actually
   * guaranteed: the close guard will not let the interviewer finish while a
   * topic is still unasked. A DURATION is not guaranteed and is no longer
   * quoted here.
   */
  questionCount: number;
  /** ISO deadline after which the link expires (surfaced to the candidate). */
  expiresAt?: string;
}

type Status =
  | "idle"
  | "connecting"
  | "live"
  | "review"
  | "submitting"
  | "done"
  | "error";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Ready when you are",
  connecting: "Connecting…",
  live: "Live, the interviewer can hear you",
  review: "Review before you submit",
  submitting: "Saving your responses…",
  done: "All done",
  error: "Something went wrong",
};

const STATUS_TONE: Record<Status, ShellTone> = {
  idle: "idle",
  connecting: "busy",
  live: "live",
  review: "info",
  submitting: "busy",
  done: "live",
  error: "idle",
};

/** LiveKit publishes live transcription segments on this text-stream topic. */
const TRANSCRIPTION_TOPIC = "lk.transcription";

/**
 * The interviewer telling us it has finished — every topic covered, goodbye
 * said. Published by the agent worker over the data channel once its closing
 * speech has actually played out.
 *
 * It carries no content, only the fact, and it cannot be used to fake a
 * submission: the server finalizes from the transcript the WORKER reported and
 * refuses a response with no candidate speech. Must stay in sync with
 * `SCREENING_FINISHED_TOPIC` in agents/screening/src/channel.ts.
 */
const SCREENING_FINISHED_TOPIC = "screening.finished";

/**
 * Data-channel topic carrying the per-answer countdown.
 *
 * The worker sends REMAINING milliseconds, not a deadline, and this component
 * anchors the countdown to the moment the packet arrived — so a candidate whose
 * system clock is minutes out still sees the right number.
 *
 * Display only. Nothing here decides when the interviewer moves on; that is the
 * worker's timer against the app's ledger, and it runs identically for a
 * candidate whose tab is in the background rendering nothing. Must stay in sync
 * with `SCREENING_ANSWER_TOPIC` in agents/screening/src/channel.ts.
 */
const SCREENING_ANSWER_TOPIC = "screening.answer";

/**
 * The one packet that travels browser -> worker: the candidate saying they have
 * finished answering. Mirrors `SCREENING_DONE_TOPIC` in
 * agents/screening/src/channel.ts.
 *
 * It exists so the countdown can be honest. Without it the worker has to guess
 * from a pause whether an answer is over, and a wrong guess either spends a
 * topic while somebody is still thinking or leaves them staring at fifty
 * seconds they cannot skip. It carries no content — the transcript is what the
 * worker reported and the app chooses every question — so the most it can do is
 * end the sender's own answer early, which is the entire point of it.
 */
const SCREENING_DONE_TOPIC = "screening.done";

/** Below this the counter turns amber. Enough time to land a sentence. */
const ANSWER_LOW_MS = 15_000;

/** Heroicons outline microphone. The one mark this whole page is built around. */
const MIC_PATH =
  "M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z";

// ─── Why the call would not start ────────────────────────────────────────────

/**
 * What stopped the call, in terms the candidate can act on.
 *
 * The video interview keeps the same shape (`classifyStartFailure`) and for the
 * same reason: a raw `NotAllowedError` under a Try again button says nothing
 * about the padlock in the address bar. Screening needs its own copy rather
 * than the interview's — there is no camera at this stage, so a sentence about
 * one would send a candidate hunting for a problem they do not have.
 */
type ScreeningFailureKind = "insecure" | "permission" | "interviewer" | "unknown";

interface ScreeningFailure {
  title: string;
  body: string;
  /** Amber for something the candidate can fix, red for something we broke. */
  tone: "warn" | "bad";
  /** Whether "Try again" can plausibly work without them leaving the page first. */
  retry: boolean;
}

const FAILURE: Record<Exclude<ScreeningFailureKind, "unknown">, ScreeningFailure> = {
  insecure: {
    title: "This page isn't on a secure connection",
    body: "Browsers only allow the microphone over a secure connection. Open the link again from the email we sent you. The address should start with https.",
    tone: "bad",
    retry: false,
  },
  permission: {
    title: "We can't hear you yet",
    body: "Your browser is blocking the microphone. Open the padlock in the address bar, set the microphone to Allow, then try again.",
    tone: "warn",
    retry: true,
  },
  interviewer: {
    title: "Something went wrong at our end",
    body: "The interviewer didn't join the call. This was not your connection and it won't count against you. Your link stays valid.",
    tone: "bad",
    retry: true,
  },
};

/**
 * Reads the DOM exception *name*, not its message: the names are specified and
 * stable across browsers, the messages are neither and are localised.
 */
function classifyScreeningFailure(
  err: unknown,
  kind?: ScreeningFailureKind,
): ScreeningFailure {
  if (kind && kind !== "unknown") return FAILURE[kind];

  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return FAILURE.permission;

  return {
    title: "We couldn't start the call",
    body:
      err instanceof Error && err.message
        ? `${err.message} Your link is still valid. Please try again.`
        : "Something interrupted the connection. Your link is still valid. Please try again.",
    tone: "bad",
    retry: true,
  };
}

/**
 * Candidate-facing voice screening, on LiveKit since the migration: the server
 * action opens a room carrying nothing but the application id, this component
 * joins with mic audio, and the server-side agent worker — which fetches its
 * own interviewer instructions from the app, because room metadata is
 * delivered to every participant including this browser — runs the interview
 * and reports the transcript as the call progresses. The browser never
 * assembles or submits transcript content: on "Submit responses" it sends only
 * the token, and the server finalizes from the agent-reported draft.
 *
 * What the client still does: live captions + a response counter from the
 * room's transcription streams (display only), a hard countdown sized from the
 * campaign's topic count (`screeningCallMinutes`, the same function the
 * interviewer paces against), and the review / re-record step (a re-record
 * simply opens a fresh room; the new draft overwrites the old).
 *
 * It renders in `CandidateShell`, the same employer-branded card as the video
 * interview, deliberately: the two are the same promise at different lengths,
 * and a candidate who does the screening should recognise the interview.
 */
/**
 * The stage element, and the reason this page is not just the interview page
 * with the video cut out: a voice call gives a candidate nothing to look at, so
 * the disc has to carry the whole "something is happening" signal that the
 * self-view carries next door. Hence the ring, which the interview has no need
 * of. `motion-safe:` because a pulsing disc is exactly what a reduced-motion
 * setting is asking us not to do.
 */
function MicDisc({ listening }: { listening: boolean }) {
  return (
    <div className="mb-5 flex justify-center">
      <span
        className={cn(
          "relative flex items-center justify-center rounded-full",
          listening ? "h-24 w-24" : "h-[88px] w-[88px]",
        )}
      >
        <span
          className={cn(
            "absolute inset-0 rounded-full motion-safe:animate-ping",
            listening ? "bg-[#BBF7D0]" : "bg-[#DBEAFE]",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "relative flex h-full w-full items-center justify-center rounded-full",
            listening ? "bg-ink text-white" : "bg-[#EFF6FF] text-primary",
          )}
        >
          <Icon
            className={listening ? "h-[38px] w-[38px]" : "h-9 w-9"}
            d={MIC_PATH}
          />
        </span>
      </span>
    </div>
  );
}

export default function VoiceScreening({
  token,
  campaignTitle,
  questionCount,
  expiresAt,
}: VoiceScreeningProps) {
  // The invisible backstop. Never displayed, never counted down, and never
  // reached by a call that is behaving: it exists for the worker that dies
  // mid-call and the tab left open in an empty room, both of which otherwise
  // bill an OpenAI Realtime session by the minute forever.
  const backstopMs = SCREENING_CALL_BACKSTOP_MINUTES * 60_000;
  const [status, setStatus] = useState<Status>("idle");
  // `error` is the inline line on the review step (a submit that failed, where
  // the call itself was fine). `failure` is the whole-screen dead end before
  // the call ever ran. They are different problems and read differently.
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ScreeningFailure | null>(null);
  // Counts the candidate's *own* spoken turns — the call is only submittable
  // once they've answered something. Display-only; the server re-checks
  // against the agent-reported transcript.
  const [responseCount, setResponseCount] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  // Live caption of the interviewer's current/last spoken question.
  const [caption, setCaption] = useState("");
  // The per-answer countdown. Null whenever nothing is being timed — before the
  // candidate starts speaking, and between questions — because a clock ticking
  // at somebody deciding what to say is the pressure this design removed.
  const [answerMs, setAnswerMs] = useState<number | null>(null);
  const [answerExpired, setAnswerExpired] = useState(false);
  // True while the budget is STOPPED because the interviewer is talking. The
  // counter stays on screen standing still: the minute has not started and has
  // not been taken away, and removing it instead meant the countdown was
  // visible for about four seconds a question and absent the rest of the call.
  const [answerPaused, setAnswerPaused] = useState(false);
  /**
   * The language the interview will be held in, chosen here rather than in the
   * call.
   *
   * It used to be the interviewer's decision, from the candidate's first
   * answer — and the model got there first: given their name and a summary of
   * their CV it inferred one and greeted them in it, before they had said a
   * word. Asked before the room is even created, it is a fact by the time the
   * interviewer opens its mouth.
   */
  const [language, setLanguage] = useState<CallLanguage>(DEFAULT_CALL_LANGUAGE);
  /**
   * They have pressed "I'm done" on the answer currently on screen.
   *
   * Cleared when a fresh minute arrives, so the button comes back for the next
   * question. Held so a second press cannot send a second packet — the worker
   * ignores one, but a button that stays live after doing its job reads as one
   * that did nothing.
   */
  const [answerEnded, setAnswerEnded] = useState(false);
  // The clock, as one object. A ref rather than state so an arriving packet
  // does not re-render, and so the ticker below can read it without
  // re-subscribing.
  //
  // One field, not two: this was a deadline ref and a frozen-value ref with a
  // comment saying they were mutually exclusive — an invariant two assignment
  // sites had to maintain and the ticker had to re-derive, when a clock is
  // simply "this much left, as of then, running or not".
  const answerClockRef = useRef<{ remainingMs: number; at: number; paused: boolean } | null>(
    null,
  );
  // Whether the counter is currently on screen, so its appearance and
  // disappearance can be logged without logging every tick.
  const shownRef = useRef(false);
  // True when the browser is blocking audio autoplay. Without a user gesture,
  // attaching the agent's track plays nothing — so we surface a tap-to-enable
  // button rather than leaving the candidate in silence.
  const [audioBlocked, setAudioBlocked] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wasLiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Segment ids of the candidate's finalized turns (segments stream in
  // revisions; a Set keeps the count exact).
  const candidateSegmentsRef = useRef<Set<string>>(new Set());
  // Interviewer-presence tracking for the silence watchdog: did the agent join
  // the room, and did its audio arrive? The watchdog reads these to pinpoint a
  // stall — "worker never joined" vs "agent joined but stayed mute".
  const agentPresentRef = useRef(false);
  const agentAudioRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the interviewer says it has covered everything. It is what tells
  // the Disconnected handler that the agent leaving is the END of the call
  // rather than a drop — without it, a completed interview lands the candidate
  // on "start over" with their whole call behind them.
  const finishedRef = useRef(false);
  // Proctoring buffer. Screening is voice-only, so tab focus is the ONLY signal
  // available here — there is no camera to watch and nothing server-side to
  // corroborate it with. It exists because this is the stage a candidate has
  // most reason to game: the question is asked before the answer is given, and
  // "hold on a second" while they search costs them nothing.
  const proctoringRef = useRef(createProctoringCollector());

  // Informational only — the server re-checks and is the real gate.
  const expired = expiresAt ? Date.now() > Date.parse(expiresAt) : false;

  // Leave the room and stop the countdown on unmount (refs only, so this runs
  // exactly once on teardown without re-subscribing every render).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      clearWatchdog();
      roomRef.current?.disconnect();
    };
  }, []);

  // Auto-unlock audio on the next interaction ANYWHERE on the page while the
  // browser is holding the interviewer's voice back — so a candidate doesn't
  // have to find the exact "Enable sound" button for audio to start. The
  // dedicated button stays as an explicit fallback.
  useEffect(() => {
    if (!audioBlocked) return;
    const tryUnlock = async () => {
      const room = roomRef.current;
      if (!room) return;
      try {
        await room.startAudio();
        for (const el of document.querySelectorAll("audio")) {
          void el.play().catch(() => {});
        }
      } catch {
        // keep the listeners; a later gesture may succeed
      }
      setAudioBlocked(!room.canPlaybackAudio);
    };
    window.addEventListener("pointerdown", tryUnlock);
    window.addEventListener("keydown", tryUnlock);
    return () => {
      window.removeEventListener("pointerdown", tryUnlock);
      window.removeEventListener("keydown", tryUnlock);
    };
  }, [audioBlocked]);

  function stopTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearWatchdog() {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }

  // Tick the per-answer countdown while the call is live. One interval for the
  // whole call, reading the anchor each tick, so an arriving packet never has
  // to tear down and rebuild a timer.
  useEffect(() => {
    if (status !== "live") {
      answerClockRef.current = null;
      setAnswerMs(null);
      setAnswerExpired(false);
      setAnswerPaused(false);
      setAnswerEnded(false);
      return;
    }
    const id = setInterval(() => {
      const clock = answerClockRef.current;
      const raw =
        clock === null
          ? null
          : clock.paused
            ? clock.remainingMs
            : Math.max(0, clock.remainingMs - (Date.now() - clock.at));
      // Quantised to the second, because the second is all that is ever drawn:
      // the counter renders `Math.ceil(answerMs / 1000)` and compares against a
      // whole-second threshold. Storing raw milliseconds at 4Hz re-rendered the
      // whole call screen four times a second on a candidate's phone, three of
      // them byte-identical. React bails out on the unchanged value instead.
      const next = raw === null ? null : Math.ceil(raw / 1000) * 1000;
      setAnswerPaused(clock?.paused === true);
      // Only the appearance and the disappearance are logged, never the ticks:
      // at four a second a per-tick line would bury the two moments that
      // actually explain what the candidate saw.
      const wasShown = shownRef.current;
      const isShown = next !== null;
      if (wasShown !== isShown) {
        shownRef.current = isShown;
        realtimeTrace(
          "voice-screening",
          isShown ? "countdown shown" : "countdown hidden",
          isShown ? { seconds: Math.ceil((next ?? 0) / 1000) } : undefined,
        );
      }
      setAnswerMs(next);
    }, 250);
    return () => clearInterval(id);
  }, [status]);

  // Arm the backstop. One timer, no ticking, and nothing rendered from it: the
  // candidate must not be able to feel a clock, because the entire point of
  // moving the budget onto each answer is that they are no longer racing one.
  function startTimer() {
    stopTimer();
    timerRef.current = setTimeout(handleTimeUp, backstopMs);
  }

  // The backstop fired, which means something went wrong rather than that the
  // interview ran long. End the call and move to review, so whatever the agent
  // did capture can still be submitted.
  function handleTimeUp() {
    setTimedOut(true);
    teardown();
    setStatus((s) => (s === "live" ? "review" : s));
  }

  function teardown() {
    stopTimer();
    clearWatchdog();
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
  }

  // Tab-focus tracking, armed only while the call is live so time spent on the
  // intro or the review step never counts against the candidate.
  //
  // Both listeners open the same condition because each misses what the other
  // catches: `visibilitychange` sees the tab hidden (switching tabs, minimising,
  // locking a phone), while `blur` sees focus leave a tab that is still visible
  // — the second window or second monitor case, which is exactly the "let me
  // just look this up" behaviour worth knowing about. `begin` is idempotent, so
  // the two firing together for one tab switch still counts once.
  useEffect(() => {
    if (status !== "live") return;
    const collector = proctoringRef.current;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") collector.begin("tab_blur", Date.now());
      else collector.end("tab_blur", Date.now());
    };
    const onBlur = () => collector.begin("tab_blur", Date.now());
    const onFocus = () => collector.end("tab_blur", Date.now());

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      // Close anything still open so a call that ends mid-blur is still counted.
      collector.end("tab_blur", Date.now());
    };
  }, [status]);

  // Attach the interviewer's audio track to our sink and nudge playback.
  // attach() alone can be swallowed by the autoplay policy, so play()
  // explicitly and reflect whether the browser is still holding it back.
  // The agent's audio arriving is the "interviewer is really here" signal, so
  // it clears the silence watchdog.
  function attachAgentAudio(track: RemoteTrack, room: Room) {
    if (track.kind !== Track.Kind.Audio || !audioRef.current) return;
    agentPresentRef.current = true;
    agentAudioRef.current = true;
    clearWatchdog();
    realtimeTrace("voice-screening", "interviewer audio attached");
    track.attach(audioRef.current);
    void audioRef.current.play().catch(() => {});
    setAudioBlocked(!room.canPlaybackAudio);
  }

  async function start() {
    // getUserMedia only exists in a secure context (https or http://localhost).
    // Over plain-http (e.g. a LAN IP), navigator.mediaDevices is undefined and
    // LiveKit throws a cryptic "reading 'getUserMedia'" — surface the real cause.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setFailure(FAILURE.insecure);
      setStatus("error");
      return;
    }
    setError(null);
    setFailure(null);
    setStatus("connecting");
    setResponseCount(0);
    setTimedOut(false);
    setCaption("");
    setAudioBlocked(false);
    candidateSegmentsRef.current = new Set();
    wasLiveRef.current = false;
    agentPresentRef.current = false;
    agentAudioRef.current = false;
    clearWatchdog();
    // Set when we already know why the throw below happened; the classifier
    // only guesses for the failures we cannot name at the throw site.
    let kind: ScreeningFailureKind | undefined;
    try {
      const grant = await startCandidateVoiceScreening(token, language);

      const room = new Room();
      roomRef.current = room;

      // The interviewer's voice: attach the agent's audio track when it lands.
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        attachAgentAudio(track, room);
      });

      // The interviewer joining is the first success milestone. The watchdog
      // uses it to tell "the worker never showed up" apart from "the agent
      // joined but stayed mute".
      room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        agentPresentRef.current = true;
        realtimeTrace("voice-screening", "interviewer joined", p.identity);
      });

      // Autoplay can be blocked until a user gesture; mirror the room's
      // playback status so the "Enable sound" prompt appears/clears correctly.
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioBlocked(!room.canPlaybackAudio);
      });

      // A drop before finishing is recoverable — the candidate can simply
      // reconnect (fresh room, fresh agent). Don't clobber a state the user
      // has already advanced to (review/submit/done).
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current) {
          teardown();
          // A finished interview is not a drop. The interviewer leaving after
          // its goodbye is the normal ending, and sending the candidate back to
          // "start over" there would discard a completed call in front of them.
          if (finishedRef.current) return;
          setStatus((s) =>
            s === "review" || s === "submitting" || s === "done" ? s : "idle",
          );
        }
      });

      // The interviewer reporting that every topic is covered and the goodbye
      // is said. The call ends here and the answers go in — no button, because
      // an interview a candidate walks away from without submitting is one
      // nobody ever scores.
      room.on(
        RoomEvent.DataReceived,
        (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
          // One line per packet. Data packets are rare (a topic change, the
          // end of the interview), and without this a countdown that never
          // appears is indistinguishable from one that never arrived.
          realtimeTrace("voice-screening", "data packet", { topic });

          if (topic === SCREENING_ANSWER_TOPIC) {
            try {
              const packet = JSON.parse(new TextDecoder().decode(payload)) as {
                remainingMs?: number | null;
                expired?: boolean;
                paused?: boolean;
              };
              const remainingMs =
                typeof packet.remainingMs === "number" ? packet.remainingMs : null;
              // Paused means the interviewer is talking: the number stands
              // still rather than ticking down through their turn. Anchored to
              // arrival, never to an absolute deadline — a candidate whose
              // system clock is wrong still sees the right number.
              const previous = answerClockRef.current;
              answerClockRef.current =
                remainingMs === null
                  ? null
                  : { remainingMs, at: Date.now(), paused: packet.paused === true };
              setAnswerExpired(packet.expired === true);
              // A fresh minute is a new question, so the button comes back. The
              // heartbeat re-sends the SAME clock every five seconds, so this
              // has to key on the number going UP rather than on merely
              // arriving — otherwise the button reappears mid-answer, seconds
              // after they pressed it.
              if (remainingMs !== null && (previous === null || remainingMs > previous.remainingMs)) {
                setAnswerEnded(false);
              }
              realtimeTrace("voice-screening", "answer clock", packet);
            } catch {
              // A malformed clock packet costs a stale number on screen and
              // nothing else. It must never take down the data handler that
              // also carries the end-of-interview signal.
            }
            return;
          }

          if (topic !== SCREENING_FINISHED_TOPIC || finishedRef.current) return;
          finishedRef.current = true;
          realtimeTrace("voice-screening", "interviewer finished; submitting");
          teardown();
          void submit();
        },
      );

      // Live transcription segments, published by the agent for both sides of
      // the conversation. Candidate turns drive the response counter; agent
      // turns drive the caption — a lifeline if the audio lags or cuts out.
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participant) => {
        const isCandidate = participant?.identity === room.localParticipant.identity;
        const segmentId = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
        let text = "";
        for await (const chunk of reader) {
          text += chunk;
          if (!isCandidate && text.trim()) setCaption(text);
        }
        const isFinal = reader.info.attributes?.["lk.transcription_final"] === "true";
        if (isCandidate && isFinal && text.trim()) {
          candidateSegmentsRef.current.add(segmentId);
          setResponseCount(candidateSegmentsRef.current.size);
        }
      });

      await room.connect(grant.serverUrl, grant.participantToken);
      realtimeTrace("voice-screening", "room connected; awaiting interviewer");

      // If the agent had already joined / published before our listeners were
      // installed (fast dispatch, or a reconnect), ParticipantConnected /
      // TrackSubscribed won't re-fire — so reconcile against what's already in
      // the room: mark the agent present and attach any existing audio.
      for (const participant of room.remoteParticipants.values()) {
        agentPresentRef.current = true;
        for (const pub of participant.audioTrackPublications.values()) {
          if (pub.track) attachAgentAudio(pub.track, room);
        }
      }

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        kind = "permission";
        throw new Error("The microphone could not be turned on.");
      }

      // The "Start interview" click is a live user gesture — use it to unlock
      // audio playback now, so the interviewer's greeting isn't swallowed by the
      // browser's autoplay policy. If it doesn't take, the button below recovers.
      try {
        await room.startAudio();
      } catch {
        // ignore — AudioPlaybackStatusChanged + the "Enable sound" button recover it
      }
      setAudioBlocked(!room.canPlaybackAudio);

      // Arm the silence watchdog: if the interviewer never joins or never
      // speaks within the window, stop waiting and surface the precise cause
      // instead of sitting on a silent room forever. Cleared the moment the
      // agent's audio arrives (attachAgentAudio).
      if (!agentAudioRef.current) {
        watchdogRef.current = setTimeout(() => {
          if (agentAudioRef.current) return;
          const { reason, devHint } = diagnoseAgentSilence({
            agentPresent: agentPresentRef.current,
            agentAudio: agentAudioRef.current,
          });
          console.error(
            `[voice-screening] interviewer silent after ${AGENT_JOIN_TIMEOUT_MS}ms (reason=${reason}). ${devHint}`,
          );
          teardown();
          // Both silence reasons are ours, and neither is worth explaining to
          // the candidate — the console keeps the distinction for us.
          setFailure(FAILURE.interviewer);
          setStatus("error");
        }, AGENT_JOIN_TIMEOUT_MS);
      }

      wasLiveRef.current = true;
      setStatus("live");
      startTimer();
    } catch (e) {
      teardown();
      setFailure(classifyScreeningFailure(e, kind));
      setStatus("error");
    }
  }

  // End the live call and move to the review step — nothing is finalized
  // until the candidate explicitly submits.
  function finish() {
    teardown();
    if (!wasLiveRef.current) {
      // Never actually connected — nothing to review.
      setStatus("idle");
      return;
    }
    setStatus("review");
  }

  /**
   * "I'm done" — end this answer now instead of waiting out the countdown.
   *
   * The counter is only fair because it runs its whole length, and the worker
   * therefore will not end a barely-started answer on a pause. That is the
   * right default and it costs somebody who genuinely finished in eight words
   * the rest of their minute, staring at a clock with nothing to do. This is
   * the way out, and it is why the default can be generous.
   *
   * Best-effort by design: the packet carries nothing, and if it never arrives
   * the countdown simply runs to zero and the call moves on by itself. So a
   * failure here is a slower answer, never a lost one — which is why it is not
   * surfaced to the candidate.
   */
  function endAnswer() {
    const room = roomRef.current;
    if (!room || answerEnded) return;
    setAnswerEnded(true);
    void room.localParticipant
      ?.publishData(new TextEncoder().encode("{}"), {
        reliable: true,
        topic: SCREENING_DONE_TOPIC,
      })
      .catch(() => {
        // Nothing to tell them: their minute is still running and still
        // visible, and it ends the answer on its own.
      });
  }

  // Discard the captured call and let the candidate record again from scratch.
  // Starting again opens a fresh room; the agent's new report overwrites the
  // previous draft server-side.
  function reRecord() {
    teardown();
    setResponseCount(0);
    setTimedOut(false);
    setCaption("");
    setAudioBlocked(false);
    candidateSegmentsRef.current = new Set();
    wasLiveRef.current = false;
    finishedRef.current = false;
    setError(null);
    setFailure(null);
    setStatus("idle");
  }

  // Retry unlocking audio playback from an explicit tap (a fresh user gesture),
  // for browsers that ignored the unlock attempt during connect.
  async function enableSound() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
    } catch {
      // still blocked — leave the button up for another try
    }
    setAudioBlocked(!room.canPlaybackAudio);
  }

  async function submit() {
    setStatus("submitting");
    setError(null);
    try {
      // Flushed once, here — never streamed during the call. The server bounds
      // the payload and decides severity; this only reports what happened.
      await submitVoiceScreening({
        token,
        proctoringEvents: proctoringRef.current.drain(Date.now()),
      });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your responses.");
      setStatus("review");
    }
  }

  const connecting = status === "connecting";
  const live = status === "live";
  const review = status === "review";
  const submitting = status === "submitting";
  const hasResponses = responseCount > 0;
  const onStage = live || connecting;

  const shell = {
    label: STATUS_LABEL[status],
    tone: STATUS_TONE[status],
    // No clock. A countdown told the candidate to hurry on a call where
    // hurrying costs them evidence, and it was the visible half of a budget
    // that now lives per answer instead.
    clock: undefined,
    clockUrgent: false,
  };

  if (status === "done") {
    return (
      <CandidateShell title="Voice screening" role={campaignTitle}>
        <div className="text-center">
          <ShellIcon tone="good">
            <Icon d="m4.5 12.75 6 6 9-13.5" strokeWidth={2.2} />
          </ShellIcon>
          <h2 className="mb-2.5 font-heading text-[26px] font-semibold tracking-[-0.015em] text-ink">
            Thanks, that&apos;s everything
          </h2>
          <p className="mx-auto mb-6 max-w-[52ch] text-[15px] leading-[1.65] text-[#4B5563]">
            Your answers for{" "}
            <strong className="font-semibold text-ink">{campaignTitle}</strong> have
            been submitted. The hiring team will be in touch by email.
          </p>
          <div className="mx-auto max-w-[52ch] rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-[18px] py-4 text-left">
            <p className="mb-1.5 text-[13px] font-semibold text-ink">
              What happens next
            </p>
            <p className="text-[13px] leading-[1.6] text-[#6B7280]">
              A person on the hiring team reads your transcript alongside your
              application. You&apos;ll hear from them either way, usually within
              a week.
            </p>
          </div>
        </div>
      </CandidateShell>
    );
  }

  // A missed deadline is not a rejection, and a candidate staring at a dead
  // link will assume it was one unless told otherwise.
  //
  // Only before they start. A deadline that rolls over mid-call must not
  // swallow a finished one: someone who was still talking keeps their review
  // step and their Submit button.
  if (expired && (status === "idle" || status === "error")) {
    return (
      <CandidateShell title="Voice screening" role={campaignTitle}>
        <ShellIcon tone="bad">
          <Icon d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </ShellIcon>
        <Heading>This link has expired</Heading>
        <Body>
          Screening links stay open for seven days. Nothing you did is lost, and
          this does not count against you. Reply to the email we sent you and a
          person will send a fresh link.
        </Body>
      </CandidateShell>
    );
  }

  if (status === "error") {
    // Never a dead end: a status of "error" with nothing classified still owes
    // the candidate a sentence and a way to try again.
    const shown = failure ?? classifyScreeningFailure(null);
    return (
      <CandidateShell title="Voice screening" role={campaignTitle} status={shell}>
        <ShellIcon tone={shown.tone}>
          <Icon d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </ShellIcon>
        <Heading>{shown.title}</Heading>
        <Body>{shown.body}</Body>
        {shown.retry && (
          <button type="button" onClick={start} className={SHELL_PRIMARY}>
            Try again
          </button>
        )}
      </CandidateShell>
    );
  }

  return (
    <CandidateShell title="Voice screening" role={campaignTitle} status={shell}>
      {status === "idle" && (
        <>
          <ShellIcon tone="neutral">
            <Icon d={MIC_PATH} />
          </ShellIcon>

          <Heading>A short spoken interview</Heading>
          {/* No duration is quoted. The call is paced one answer at a time and
              ends when the interviewer has covered its topics, so a number of
              minutes was a promise this page had no way to keep. The QUESTION
              COUNT is kept because it is the one thing about the call's shape
              that IS guaranteed: the close guard will not let the interviewer
              finish while a topic is still unasked. */}
          <Body>
            When you start, allow microphone access. The interviewer will greet
            you and ask{" "}
            <strong className="font-semibold text-ink">
              {questionCount} {questionCount === 1 ? "question" : "questions"}
            </strong>
            . Speak naturally and take your time.
          </Body>

          {/* Three blocks, in the order a candidate needs them: what we promise,
              what they have to do, then the one choice they have to make. The
              promises are said before the call rather than after, because these
              are the three things a candidate is most likely to be anxious
              about and answering them afterwards is answering them too late. */}
          <div className="mx-auto mb-3.5 w-full max-w-[56ch] rounded-xl border border-[#E5E7EB] bg-white px-[17px] py-[15px]">
            <p className="mb-3 text-[13px] font-semibold text-ink">
              What to expect
            </p>
            <ul className="flex flex-col gap-[11px]">
              <Assurance>
                Nothing is recorded. Only a written transcript is kept.
              </Assurance>
              {/* The interviewer submits for them when it signs off, so "nothing
                  is sent until you press submit" would be a promise this page
                  breaks a few minutes later. */}
              <Assurance>
                When the interviewer says goodbye the call ends and your answers
                go in. There is nothing to press.
              </Assurance>
              <Assurance>
                A person reads everything before any decision is made.
              </Assurance>
            </ul>
          </div>

          {/* Monitoring is disclosed before consent, not discovered after it,
              the same rule the video interview holds to. Tab focus is the only
              signal this stage has, and it is still one a candidate is entitled
              to know about before agreeing to be watched by it. */}
          <div
            role="note"
            className="mx-auto mb-6 w-full max-w-[56ch] rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[17px] py-[15px]"
          >
            <p className="mb-3 flex items-center gap-[9px] text-[13px] font-semibold text-[#92400E]">
              <Icon
                className="h-4 w-4 shrink-0"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
              Before you start
            </p>
            <p className="text-[13px] leading-[1.65] text-[#92400E]">
              Find a quiet room with no chatter or music, and use headphones
              with a mic if you have them. Background noise makes it harder for
              the interviewer to understand you. Please stay on this tab for the
              whole call:{" "}
              <strong className="font-semibold">
                leaving it is noted for the hiring team.
              </strong>
            </p>
          </div>

          {/* Asked before the room exists, so the interviewer is TOLD the
              language rather than guessing one from a name and a CV. Two
              buttons rather than a select: there are two options, both are one
              word, and a select hides one of them behind a tap.

              Left on plain white rather than boxed like the two blocks above
              it, so the only thing on this screen the candidate has to DECIDE
              reads as part of the action zone with the Start button, not as a
              third thing to read. */}
          <fieldset className="mx-auto mb-6 w-full max-w-[56ch]">
            <legend className="mb-[9px] text-[13px] font-semibold text-ink">
              Which language would you like the interview in?
            </legend>
            <div className="flex gap-[9px]">
              {CALL_LANGUAGES.map((option) => {
                const selected = option === language;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setLanguage(option)}
                    className={cn(
                      "min-h-[46px] flex-1 rounded-xl border px-4 text-[15px] font-medium transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      selected
                        ? "border-ink bg-ink text-white"
                        : "cursor-pointer border-[#E5E7EB] bg-white text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]",
                    )}
                  >
                    {CALL_LANGUAGE_LABELS[option]}
                  </button>
                );
              })}
            </div>
            <p className="mt-[9px] text-[13px] leading-[1.55] text-[#6B7280]">
              The whole call will be in the language you pick. It cannot be
              changed once you start.
            </p>
          </fieldset>

          <button type="button" onClick={start} className={SHELL_PRIMARY}>
            <Icon className="h-[18px] w-[18px]" d={MIC_PATH} strokeWidth={2} />
            Start interview
          </button>
          <Deadline expiresAt={expiresAt} />
        </>
      )}

      {connecting && (
        <>
          <MicDisc listening={false} />
          <p className="mb-1.5 text-center text-[17px] font-semibold text-ink">
            Connecting you now
          </p>
          <p className="mx-auto max-w-[52ch] text-center text-sm leading-[1.6] text-[#6B7280]">
            If your browser asks for the microphone, choose{" "}
            <strong className="font-semibold text-[#374151]">Allow</strong>. The
            interviewer will say hello first.
          </p>
        </>
      )}

      {live && <MicDisc listening />}

      {/* Autoplay unlock prompt. The call keeps running while this shows — the
          captions below carry the question, so nothing is missed by tapping
          late, which is the one thing this banner has to say. */}
      {onStage && audioBlocked && (
        <div className="mb-4">
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[15px] py-[13px]"
          >
            <p className="text-[13px] leading-[1.55] text-[#92400E]">
              <strong className="font-semibold">
                Sound is blocked by your browser.
              </strong>{" "}
              Tap to hear the interviewer.
            </p>
            <button
              type="button"
              onClick={enableSound}
              className="min-h-10 shrink-0 cursor-pointer rounded-lg bg-[#B45309] px-3 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#92400E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B45309] focus-visible:ring-offset-2"
            >
              Enable sound
            </button>
          </div>
          <p className="mt-2 text-center text-[13px] leading-[1.55] text-[#9CA3AF]">
            The call keeps running while this shows. The captions carry the
            question, so nothing is missed if you tap late.
          </p>
        </div>
      )}

      {live && (
        <>
          {/* Live captions of the interviewer's questions — a lifeline if the
              audio lags or cuts out, and the only thing on screen carrying words
              while someone is being asked something. */}
          <div className="mb-4 overflow-hidden rounded-[14px] border border-[#E5E7EB]">
            <p className="border-b border-[#F3F4F6] bg-[#F9FAFB] px-[15px] py-[9px] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
              Interviewer
            </p>
            <p
              aria-live="polite"
              className="min-h-[88px] px-[22px] py-5 text-lg leading-[1.6] text-ink"
            >
              {caption || (
                <span className="text-[#9CA3AF]">
                  Listening… the interviewer&apos;s questions appear here as they
                  speak.
                </span>
              )}
            </p>
          </div>

          {/* The per-answer countdown, shown whenever a question is
              outstanding — including before the candidate has said anything,
              because the silence fallback is a real deadline and hiding it
              would remove the warning rather than the pressure. Amber under
              fifteen seconds; at zero it stops being a number and becomes an
              instruction, because at that point the honest thing to show is
              what the call is about to do.

              It is the ONLY counter on this screen. A separate "wrapping up"
              countdown was tried and removed: the last question's minute is
              the candidate's, and a second clock appearing the moment they
              stopped talking read as being hurried off a call they had not
              finished. The interview now ends on the goodbye, with nothing
              counting down to it. */}
          {answerMs !== null && (
            <div
              className={cn(
                "mb-4 flex items-center justify-between rounded-[14px] border px-[15px] py-[11px] transition-colors duration-150",
                !answerPaused && (answerExpired || answerMs <= ANSWER_LOW_MS)
                  ? "border-[#FDE68A] bg-[#FFFBEB]"
                  : "border-[#E5E7EB] bg-[#F9FAFB]",
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                  Your answer
                </span>
                {/* A number standing still with no explanation reads as broken,
                    which is the one way a paused counter is worse than none. */}
                {answerPaused && (
                  <span className="text-[11px] leading-none text-[#9CA3AF]">
                    starts when they finish asking
                  </span>
                )}
              </span>
              <span
                aria-live="off"
                className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  answerPaused
                    ? "text-[#9CA3AF]"
                    : answerExpired || answerMs <= ANSWER_LOW_MS
                      ? "text-[#92400E]"
                      : "text-ink",
                )}
              >
                {formatClock(Math.ceil(answerMs / 1000))}
              </span>
            </div>
          )}

          {/* Only while the minute is actually theirs: not while the
              interviewer is still asking, not once it has run out, and not
              twice. The worker will not end a barely-started answer on a pause
              — that is what stops a thinking pause spending a topic — so this
              is how somebody who really has finished skips the wait. */}
          {answerMs !== null && !answerPaused && !answerExpired && !answerEnded && (
            <button
              type="button"
              onClick={endAnswer}
              className={cn(
                SHELL_SECONDARY,
                "mb-4 min-h-[44px] w-full text-[14px] font-medium",
              )}
            >
              I&apos;m done with this answer
            </button>
          )}

          {answerEnded && !answerExpired && (
            <p
              aria-live="polite"
              className="mb-4 text-center text-[13px] leading-[1.55] text-[#6B7280]"
            >
              Thanks. Moving on to the next question.
            </p>
          )}

          {answerExpired && !answerPaused && (
            <p
              aria-live="polite"
              className="mb-4 text-center text-[13px] leading-[1.55] text-[#92400E]"
            >
              Time&apos;s up. Moving on to the next question.
            </p>
          )}

          <p className="mb-5 text-center text-[13px] text-[#6B7280]">
            {hasResponses
              ? `${responseCount} ${responseCount === 1 ? "response" : "responses"} captured so far.`
              : "Nothing captured yet. The interviewer will start the questions."}
          </p>

          <button
            type="button"
            onClick={finish}
            className={cn(SHELL_SECONDARY, "min-h-[54px] text-base")}
          >
            I&apos;m finished
          </button>
          <p className="mt-3 text-center text-[13px] leading-[1.55] text-[#9CA3AF]">
            No timer on the call itself. Each question gets about a minute,
            counting down from when the interviewer finishes asking it.
          </p>
        </>
      )}

      {review && (
        <>
          <ShellIcon tone="info">
            <Icon d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </ShellIcon>

          {timedOut && <Heading>The call ended</Heading>}

          {hasResponses ? (
            <>
              {!timedOut && <Heading>That&apos;s the interview done</Heading>}
              <p className="mx-auto mb-[22px] max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
                We captured{" "}
                <strong className="font-semibold text-ink">
                  {responseCount} spoken{" "}
                  {responseCount === 1 ? "response" : "responses"}
                </strong>
                . Submit when you&apos;re ready, or take it again. Nothing has
                been sent yet.
              </p>
            </>
          ) : (
            <>
              {!timedOut && <Heading>We didn&apos;t catch any answers</Heading>}
              <p className="mx-auto mb-[22px] max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
                That usually means the microphone wasn&apos;t picking you up.
                Please re-record before submitting. An empty submission would
                leave the team nothing to read.
              </p>
            </>
          )}

          <div className="flex flex-col items-center gap-2.5">
            {/* An empty call is never submittable: a blank transcript reaching
                the team helps nobody, least of all the candidate. */}
            {hasResponses && (
              <button type="button" onClick={submit} className={SHELL_PRIMARY}>
                Submit responses
              </button>
            )}
            <button type="button" onClick={reRecord} className={SHELL_SECONDARY}>
              Re-record
            </button>
          </div>
          <Deadline expiresAt={expiresAt} />
        </>
      )}

      {submitting && (
        <div className="py-[26px] text-center">
          <span
            className="mb-[18px] inline-block h-[34px] w-[34px] rounded-full border-[3px] border-[#E5E7EB] border-t-ink motion-safe:animate-spin"
            aria-hidden="true"
          />
          <p className="mb-1.5 text-[17px] font-semibold text-ink">
            Saving your responses…
          </p>
          <p className="text-sm text-[#6B7280]">Don&apos;t close this page.</p>
        </div>
      )}

      {error && (
        <p className="mt-4 text-center text-[13px] text-[#B91C1C]" role="alert">
          {error}
        </p>
      )}

      {/* Interviewer audio sink. */}
      <audio ref={audioRef} autoPlay />
    </CandidateShell>
  );
}
