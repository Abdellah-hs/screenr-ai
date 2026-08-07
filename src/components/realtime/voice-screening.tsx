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

interface VoiceScreeningProps {
  token: string;
  campaignTitle: string;
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
  live: "Live — the interviewer can hear you",
  review: "Review before you submit",
  submitting: "Saving your responses…",
  done: "All done",
  error: "Something went wrong",
};

const STATUS_DOT: Record<Status, string> = {
  idle: "bg-[#94A3B8]",
  connecting: "bg-amber-500 animate-pulse",
  live: "bg-green-500",
  review: "bg-[#0369A1]",
  submitting: "bg-amber-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
};

/** Hard cap on the live call. When it hits 0 the call is ended and the
 *  candidate is taken to the review step to submit. */
const CALL_SECONDS = 5 * 60;

/** LiveKit publishes live transcription segments on this text-stream topic. */
const TRANSCRIPTION_TOPIC = "lk.transcription";

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PRIMARY_BTN =
  "px-4 py-2 text-sm font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Candidate-facing voice screening, on LiveKit since the migration: the server
 * action opens a room (agent instructions live in its metadata, out of the
 * candidate's reach), this component joins with mic audio, and the server-side
 * agent worker runs the interview and reports the transcript to the app as
 * the call progresses. The browser never assembles or submits transcript
 * content anymore — on "Submit responses" it sends only the token, and the
 * server finalizes from the agent-reported draft.
 *
 * What the client still does: live captions + a response counter from the
 * room's transcription streams (display only), a hard 5-minute countdown, and
 * the review / re-record step (a re-record simply opens a fresh room; the new
 * draft overwrites the old).
 */
export default function VoiceScreening({
  token,
  campaignTitle,
  expiresAt,
}: VoiceScreeningProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Counts the candidate's *own* spoken turns — the call is only submittable
  // once they've answered something. Display-only; the server re-checks
  // against the agent-reported transcript.
  const [responseCount, setResponseCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(CALL_SECONDS);
  const [timedOut, setTimedOut] = useState(false);
  // Live caption of the interviewer's current/last spoken question.
  const [caption, setCaption] = useState("");
  // True when the browser is blocking audio autoplay. Without a user gesture,
  // attaching the agent's track plays nothing — so we surface a tap-to-enable
  // button rather than leaving the candidate in silence.
  const [audioBlocked, setAudioBlocked] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wasLiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Segment ids of the candidate's finalized turns (segments stream in
  // revisions; a Set keeps the count exact).
  const candidateSegmentsRef = useRef<Set<string>>(new Set());
  // Interviewer-presence tracking for the silence watchdog: did the agent join
  // the room, and did its audio arrive? The watchdog reads these to pinpoint a
  // stall — "worker never joined" vs "agent joined but stayed mute".
  const agentPresentRef = useRef(false);
  const agentAudioRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (timerRef.current) clearInterval(timerRef.current);
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
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearWatchdog() {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }

  // Start the 5-minute countdown. Computes remaining time from a fixed deadline
  // each tick, so a throttled/backgrounded tab can't drift the clock.
  function startTimer() {
    stopTimer();
    const deadline = Date.now() + CALL_SECONDS * 1000;
    setSecondsLeft(CALL_SECONDS);
    timerRef.current = setInterval(() => {
      const remain = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(remain);
      if (remain <= 0) {
        stopTimer();
        handleTimeUp();
      }
    }, 250);
  }

  // Hard cap reached: end the call and move to review so the candidate can
  // still submit what the agent captured.
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
      setError(
        "Your browser can't access the microphone on this page. It needs a secure connection — open this link over https, or on this computer use http://localhost:3000.",
      );
      setStatus("error");
      return;
    }
    setError(null);
    setStatus("connecting");
    setResponseCount(0);
    setSecondsLeft(CALL_SECONDS);
    setTimedOut(false);
    setCaption("");
    setAudioBlocked(false);
    candidateSegmentsRef.current = new Set();
    wasLiveRef.current = false;
    agentPresentRef.current = false;
    agentAudioRef.current = false;
    clearWatchdog();
    try {
      const grant = await startCandidateVoiceScreening(token);

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
          setStatus((s) =>
            s === "review" || s === "submitting" || s === "done" ? s : "idle",
          );
        }
      });

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
        throw new Error(
          "We couldn't turn on your microphone. Please allow microphone access in your browser and try again.",
        );
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
          const { reason, message, devHint } = diagnoseAgentSilence({
            agentPresent: agentPresentRef.current,
            agentAudio: agentAudioRef.current,
          });
          console.error(
            `[voice-screening] interviewer silent after ${AGENT_JOIN_TIMEOUT_MS}ms (reason=${reason}). ${devHint}`,
          );
          teardown();
          setError(message);
          setStatus("error");
        }, AGENT_JOIN_TIMEOUT_MS);
      }

      wasLiveRef.current = true;
      setStatus("live");
      startTimer();
    } catch (e) {
      teardown();
      setError(e instanceof Error ? e.message : "Failed to start the call.");
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

  // Discard the captured call and let the candidate record again from scratch.
  // Starting again opens a fresh room; the agent's new report overwrites the
  // previous draft server-side.
  function reRecord() {
    teardown();
    setResponseCount(0);
    setSecondsLeft(CALL_SECONDS);
    setTimedOut(false);
    setCaption("");
    setAudioBlocked(false);
    candidateSegmentsRef.current = new Set();
    wasLiveRef.current = false;
    setError(null);
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
  const lowTime = secondsLeft <= 60;

  if (status === "done") {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[#111827]">Thanks — that&apos;s everything</h2>
        <p className="text-sm text-[#6B7280]">
          Your responses for <strong>{campaignTitle}</strong> have been recorded. The hiring
          team will be in touch by email.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
          <span className="text-sm font-medium text-[#0C4A6E]" role="status" aria-live="polite">
            {STATUS_LABEL[status]}
          </span>
        </div>
        {live && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${
              lowTime ? "bg-red-50 text-red-600" : "bg-[#F0F9FF] text-[#0369A1]"
            }`}
            role="timer"
            aria-label={`${secondsLeft} seconds remaining`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatClock(secondsLeft)}
          </span>
        )}
      </div>

      {status === "idle" && !expired && (
        <>
          <p className="text-sm text-[#6B7280]">
            This is a short spoken interview for <strong>{campaignTitle}</strong> — about{" "}
            <strong>5 minutes</strong>. When you start, allow microphone access and the
            interviewer will greet you and ask a few questions. Speak naturally — you can take
            your time, and you&apos;ll be able to review before submitting.
          </p>

          {/* Pre-call environment notice. */}
          <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3" role="note">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs leading-relaxed text-[#92400E]">
              <strong>Find a quiet room before you start.</strong> Background noise makes it
              harder for the interviewer to understand you. Use a quiet space with no chatter or
              music, and headphones with a mic if you have them.
            </p>
          </div>
        </>
      )}

      {expired && status !== "submitting" && (
        <p className="text-sm text-red-600" role="alert">
          This link has expired. Please contact the hiring team for a new one.
        </p>
      )}

      {expiresAt && !expired && (status === "idle" || review) && (
        <p className="text-xs text-[#6B7280]">
          Please complete by <strong>{formatDeadline(expiresAt)}</strong>.
        </p>
      )}

      {/* Autoplay unlock prompt — shown only when the browser is holding back
          the interviewer's audio until an explicit tap. */}
      {(live || connecting) && audioBlocked && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3" role="alert">
          <p className="text-xs leading-relaxed text-[#92400E]">
            <strong>Sound is blocked by your browser.</strong> Tap to hear the interviewer.
          </p>
          <button
            type="button"
            onClick={enableSound}
            className="shrink-0 rounded-lg bg-[#B45309] px-3 py-1.5 text-xs font-medium text-white cursor-pointer hover:bg-[#92400E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B45309] focus-visible:ring-offset-2 transition-colors duration-200"
          >
            Enable sound
          </button>
        </div>
      )}

      {/* Live captions of the interviewer's questions — a lifeline if the audio
          lags or cuts out. */}
      {(live || connecting) && (
        <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] p-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#0369A1]">
            Interviewer
          </p>
          <p className="min-h-[1.5rem] text-sm leading-relaxed text-[#0C4A6E]" aria-live="polite">
            {caption || (
              <span className="text-[#6B7280]">
                Listening… the interviewer&apos;s questions will appear here as they speak.
              </span>
            )}
          </p>
        </div>
      )}

      {live && hasResponses && (
        <p className="text-xs text-[#6B7280]">{responseCount} responses captured so far.</p>
      )}

      {review && (
        <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] p-4">
          {timedOut && (
            <p className="mb-1 text-sm font-medium text-[#0C4A6E]">
              Your 5 minutes are up.
            </p>
          )}
          {hasResponses ? (
            <p className="text-sm text-[#0C4A6E]">
              We captured <strong>{responseCount}</strong> spoken{" "}
              {responseCount === 1 ? "response" : "responses"}. Submit when you&apos;re
              ready, or re-record if you&apos;d like another take.
            </p>
          ) : (
            <p className="text-sm text-[#0C4A6E]">
              We didn&apos;t catch any spoken answers on that call. Please re-record before
              submitting.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!live && !review && !submitting && (
          <button type="button" onClick={start} disabled={connecting || expired} className={PRIMARY_BTN}>
            {connecting ? "Connecting…" : status === "error" ? "Try again" : "Start interview"}
          </button>
        )}
        {live && (
          <button type="button" onClick={finish} className={PRIMARY_BTN}>
            I&apos;m finished
          </button>
        )}
        {review && hasResponses && (
          <button type="button" onClick={submit} className={PRIMARY_BTN}>
            Submit responses
          </button>
        )}
        {review && (
          <button
            type="button"
            onClick={reRecord}
            className="px-4 py-2 text-sm font-medium text-[#0C4A6E] bg-white border border-[#BAE6FD] rounded-lg cursor-pointer hover:bg-[#F0F9FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-colors duration-200"
          >
            Re-record
          </button>
        )}
        {submitting && (
          <button type="button" disabled className={PRIMARY_BTN}>
            Saving…
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {/* Interviewer audio sink. */}
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
