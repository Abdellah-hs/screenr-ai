"use client";

import { useRef, useState } from "react";
import {
  startCandidateVoiceScreening,
  submitVoiceScreening,
  reportVoiceScreeningFailure,
} from "@/lib/actions/respond";
import type { VoiceTranscriptTurn } from "@/lib/data/screening-questions";

interface VoiceScreeningProps {
  token: string;
  campaignTitle: string;
}

type Status = "idle" | "connecting" | "live" | "submitting" | "done" | "error";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Ready when you are",
  connecting: "Connecting…",
  live: "Live — the interviewer can hear you",
  submitting: "Saving your responses…",
  done: "All done",
  error: "Something went wrong",
};

const STATUS_DOT: Record<Status, string> = {
  idle: "bg-[#94A3B8]",
  connecting: "bg-amber-500 animate-pulse",
  live: "bg-green-500",
  submitting: "bg-amber-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
};

/**
 * Candidate-facing voice screening (#83). Mints a token-gated OpenAI Realtime
 * session, opens a browser WebRTC mic connection straight to OpenAI, captures
 * the spoken transcript from the data channel, and on finish persists it via
 * `submitVoiceScreening` (→ screening_completed). A finished call that yielded
 * no transcript is reported explicitly via `reportVoiceScreeningFailure`.
 */
export default function VoiceScreening({ token, campaignTitle }: VoiceScreeningProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The authoritative transcript at submit time — a ref so the latest turns are
  // captured regardless of React render batching.
  const transcriptRef = useRef<VoiceTranscriptTurn[]>([]);
  const wasLiveRef = useRef(false);

  function pushTurn(role: VoiceTranscriptTurn["role"], text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    transcriptRef.current.push({ role, text: trimmed, at: new Date().toISOString() });
    setTurnCount(transcriptRef.current.length);
  }

  function teardown() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    streamRef.current = null;
    pcRef.current = null;
  }

  async function start() {
    setError(null);
    setStatus("connecting");
    transcriptRef.current = [];
    setTurnCount(0);
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
      dc.addEventListener("open", () => {
        dc.send(JSON.stringify({ type: "response.create" }));
      });
      dc.addEventListener("message", (e) => {
        try {
          const evt = JSON.parse(e.data) as { type?: string; transcript?: string };
          // Candidate speech (ASR on the input audio buffer).
          if (
            evt.type === "conversation.item.input_audio_transcription.completed" &&
            evt.transcript
          ) {
            pushTurn("candidate", evt.transcript);
          }
          // Agent's spoken output transcript.
          if (evt.type === "response.output_audio_transcript.done" && evt.transcript) {
            pushTurn("agent", evt.transcript);
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
        }
        if (st === "failed" || st === "disconnected" || st === "closed") {
          // A drop before finishing is recoverable — keep the application in
          // screening_sent so the candidate can simply reconnect.
          if (pcRef.current) {
            teardown();
            setStatus((s) => (s === "submitting" || s === "done" ? s : "idle"));
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

  async function finish() {
    teardown();
    const turns = transcriptRef.current;

    // Never connected / no turns and never went live → just reset; nothing to
    // persist and the link is still valid for a retry.
    if (turns.length === 0 && !wasLiveRef.current) {
      setStatus("idle");
      return;
    }

    setStatus("submitting");
    setError(null);
    try {
      if (turns.length > 0) {
        await submitVoiceScreening({ token, transcript: turns });
      } else {
        // Live, but capture produced nothing — explicit failure, never silent.
        await reportVoiceScreeningFailure({ token });
      }
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your responses.");
      setStatus("error");
    }
  }

  const connecting = status === "connecting";
  const live = status === "live";
  const submitting = status === "submitting";

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
          Your responses for <strong>{campaignTitle}</strong> have been recorded. The hiring team
          will be in touch by email.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
        <span className="text-sm font-medium text-[#0C4A6E]" role="status" aria-live="polite">
          {STATUS_LABEL[status]}
        </span>
      </div>

      {status === "idle" && (
        <p className="text-sm text-[#6B7280]">
          This is a short spoken interview for <strong>{campaignTitle}</strong>. When you start,
          allow microphone access and the interviewer will greet you and ask a few questions. Speak
          naturally — you can take your time.
        </p>
      )}

      {live && turnCount > 0 && (
        <p className="text-xs text-[#6B7280]">{turnCount} responses captured so far.</p>
      )}

      <div className="flex gap-2">
        {!live && !submitting && (
          <button
            type="button"
            onClick={start}
            disabled={connecting}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? "Connecting…" : status === "error" ? "Try again" : "Start interview"}
          </button>
        )}
        {live && (
          <button
            type="button"
            onClick={finish}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200"
          >
            I&apos;m finished
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
