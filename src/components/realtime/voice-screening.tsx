"use client";

import { useEffect, useRef, useState } from "react";
import {
  startCandidateVoiceScreening,
  submitVoiceScreening,
} from "@/lib/actions/respond";
import type { VoiceTranscriptTurn } from "@/lib/data/screening-questions";

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

/** Hard cap on the live call. When it hits 0 the agent is stopped (#: voice
 *  polish) and the candidate is taken to the review step to submit. */
const CALL_SECONDS = 5 * 60;

/** Seconds-remaining at which we ask the agent to wrap up gracefully, so the
 *  hard cap above is a rare backstop rather than a mid-sentence guillotine. */
const WIND_DOWN_SECONDS = 60;

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
 * Candidate-facing voice screening (#80/#83/#85). Mints a token-gated OpenAI
 * Realtime session, opens a browser WebRTC mic connection straight to OpenAI,
 * and captures the spoken transcript from the data channel. On finishing the
 * call the candidate lands on a review step where they can submit (#85:
 * → screening_completed) or re-record from scratch before committing.
 *
 * Voice-polish additions: a hard 5-minute countdown that stops the agent when
 * it expires, a pre-call "find a quiet room" notice, and live on-screen
 * captions of the interviewer's questions so a candidate with audio lag can
 * still read what was asked.
 */
export default function VoiceScreening({
  token,
  campaignTitle,
  expiresAt,
}: VoiceScreeningProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Counts the candidate's *own* spoken turns — the interviewer's questions are
  // turns too, but a call is only submittable once the candidate has answered.
  const [responseCount, setResponseCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(CALL_SECONDS);
  const [timedOut, setTimedOut] = useState(false);
  const [wrappingUp, setWrappingUp] = useState(false);
  // Live caption of the interviewer's current/last spoken question.
  const [caption, setCaption] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The authoritative transcript at submit time — a ref so the latest turns are
  // captured regardless of React render batching.
  const transcriptRef = useRef<VoiceTranscriptTurn[]>([]);
  const wasLiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards the one-shot wind-down nudge so it fires once per call.
  const windDownSentRef = useRef(false);
  // Accumulates streaming agent-transcript deltas for the live caption.
  const agentBufRef = useRef("");

  // Informational only — the server re-checks and is the real gate (#83).
  const expired = expiresAt ? Date.now() > Date.parse(expiresAt) : false;

  // Stop the mic, the call, and the countdown on unmount (refs only, so this
  // runs exactly once on teardown without re-subscribing every render).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
    };
  }, []);

  function pushTurn(role: VoiceTranscriptTurn["role"], text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    transcriptRef.current.push({ role, text: trimmed, at: new Date().toISOString() });
    setResponseCount(transcriptRef.current.filter((t) => t.role === "candidate").length);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Start the 5-minute countdown. Computes remaining time from a fixed deadline
  // each tick, so a throttled/backgrounded tab can't drift the clock.
  function startTimer() {
    stopTimer();
    const deadline = Date.now() + CALL_SECONDS * 1000;
    setSecondsLeft(CALL_SECONDS);
    windDownSentRef.current = false;
    setWrappingUp(false);
    timerRef.current = setInterval(() => {
      const remain = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(remain);
      if (remain <= WIND_DOWN_SECONDS && remain > 0 && !windDownSentRef.current) {
        windDownSentRef.current = true;
        setWrappingUp(true);
        sendWindDown();
      }
      if (remain <= 0) {
        stopTimer();
        handleTimeUp();
      }
    }, 250);
  }

  // Best-effort nudge over the data channel: ask the agent to land the plane so
  // the hard cap is a rare backstop, not the normal ending. A closed channel or
  // a bad event shape must never break the call, hence the guard + swallow.
  function sendWindDown() {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    try {
      dc.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "You have about one minute left. If you haven't already, ask your final question now, then warmly thank the candidate and tell them the hiring team will follow up by email. Keep it brief and natural.",
          },
        }),
      );
    } catch {
      // Channel hiccup — the hard timeout still stops the call.
    }
  }

  // Hard cap reached: stop the agent (closing the call cuts its voice) and move
  // to review so the candidate can still submit what was captured.
  function handleTimeUp() {
    setTimedOut(true);
    teardown();
    setStatus((s) => (s === "live" ? "review" : s));
  }

  function teardown() {
    stopTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    streamRef.current = null;
    pcRef.current = null;
    dcRef.current = null;
  }

  async function start() {
    setError(null);
    setStatus("connecting");
    transcriptRef.current = [];
    setResponseCount(0);
    setSecondsLeft(CALL_SECONDS);
    setTimedOut(false);
    setWrappingUp(false);
    windDownSentRef.current = false;
    setCaption("");
    agentBufRef.current = "";
    wasLiveRef.current = false;
    try {
      const session = await startCandidateVoiceScreening(token);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        dc.send(JSON.stringify({ type: "response.create" }));
      });
      dc.addEventListener("message", (e) => {
        try {
          const evt = JSON.parse(e.data) as {
            type?: string;
            transcript?: string;
            delta?: string;
          };
          // Candidate speech (ASR on the input audio buffer).
          if (
            evt.type === "conversation.item.input_audio_transcription.completed" &&
            evt.transcript
          ) {
            pushTurn("candidate", evt.transcript);
          }
          // A new agent turn is starting — reset the caption buffer.
          if (evt.type === "response.created") {
            agentBufRef.current = "";
          }
          // Streaming agent transcript — drives the live caption as the
          // interviewer speaks, so a lagging audio stream still shows the words.
          if (evt.type === "response.output_audio_transcript.delta" && evt.delta) {
            agentBufRef.current += evt.delta;
            setCaption(agentBufRef.current);
          }
          // Agent's spoken output transcript (final for the turn).
          if (evt.type === "response.output_audio_transcript.done" && evt.transcript) {
            pushTurn("agent", evt.transcript);
            setCaption(evt.transcript);
            agentBufRef.current = "";
          }
        } catch {
          // Non-JSON / unrelated event — ignore.
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        const st = pc.connectionState;
        if (st === "connected") {
          wasLiveRef.current = true;
          setStatus("live");
          startTimer();
        }
        if (st === "failed" || st === "disconnected" || st === "closed") {
          // A drop before finishing is recoverable — keep the application in
          // screening_sent so the candidate can simply reconnect. Don't clobber
          // a state the user has already advanced to (review/submit/done).
          if (pcRef.current) {
            teardown();
            setStatus((s) =>
              s === "review" || s === "submitting" || s === "done" ? s : "idle",
            );
          }
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        throw new Error(`Couldn't connect the call (${sdpRes.status}). Please try again.`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e) {
      teardown();
      setError(e instanceof Error ? e.message : "Failed to start the call.");
      setStatus("error");
    }
  }

  // End the live call and move to the review step (#85) — nothing is persisted
  // until the candidate explicitly submits.
  function finish() {
    teardown();
    if (transcriptRef.current.length === 0 && !wasLiveRef.current) {
      // Never actually connected — nothing to review.
      setStatus("idle");
      return;
    }
    setStatus("review");
  }

  // Discard the captured call and let the candidate record again from scratch.
  function reRecord() {
    teardown();
    transcriptRef.current = [];
    setResponseCount(0);
    setSecondsLeft(CALL_SECONDS);
    setTimedOut(false);
    setWrappingUp(false);
    windDownSentRef.current = false;
    setCaption("");
    agentBufRef.current = "";
    wasLiveRef.current = false;
    setError(null);
    setStatus("idle");
  }

  async function submit() {
    const turns = transcriptRef.current;
    // No candidate speech → nothing to score. The server rejects it and would
    // otherwise have the AI fabricate answers; re-record instead of submitting.
    if (!turns.some((t) => t.role === "candidate")) return;
    setStatus("submitting");
    setError(null);
    try {
      await submitVoiceScreening({ token, transcript: turns });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your responses.");
      setStatus("error");
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

      {live && wrappingUp && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[#B45309]" role="status">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Wrapping up — about a minute left.
        </p>
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
              {responseCount === 1 ? "response" : "responses"}. Review them below and submit
              when you&apos;re ready.
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
        {review && !hasResponses && (
          <button type="button" onClick={reRecord} className={PRIMARY_BTN}>
            Try again
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

      {/* Agent audio sink. */}
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
