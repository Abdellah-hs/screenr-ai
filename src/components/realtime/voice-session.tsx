"use client";

import { useRef, useState } from "react";
import { startVoiceSpikeSession, startScreeningPreviewSession } from "@/lib/actions/realtime";

interface VoiceSessionProps {
  /** When set, runs the campaign's screening script; otherwise a bare connectivity check. */
  campaignId?: string;
}

type Status = "idle" | "connecting" | "live" | "error";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  live: "Live — speak now",
  error: "Connection failed",
};

const STATUS_DOT: Record<Status, string> = {
  idle: "bg-[#94A3B8]",
  connecting: "bg-amber-500 animate-pulse",
  live: "bg-green-500",
  error: "bg-red-500",
};

/**
 * SPIKE (#81): bare browser ↔ OpenAI Realtime voice connection.
 *
 * Mints an ephemeral key via the server action, then opens a WebRTC peer
 * connection straight to OpenAI: mic track up, agent audio down, a data
 * channel to kick off the greeting. No scoring, no persistence yet.
 */
export default function VoiceSession({ campaignId }: VoiceSessionProps = {}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function teardown() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    streamRef.current = null;
    pcRef.current = null;
  }

  function stop() {
    teardown();
    setStatus((s) => (s === "error" ? s : "idle"));
  }

  async function start() {
    setError(null);
    setStatus("connecting");
    try {
      const session = campaignId
        ? await startScreeningPreviewSession(campaignId)
        : await startVoiceSpikeSession();

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Agent's voice comes back on a remote track.
      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      };

      // Candidate mic up.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // Event channel — ask the agent to greet as soon as it opens.
      const dc = pc.createDataChannel("oai-events");
      dc.addEventListener("open", () => {
        dc.send(JSON.stringify({ type: "response.create" }));
      });

      pc.addEventListener("connectionstatechange", () => {
        const st = pc.connectionState;
        if (st === "connected") setStatus("live");
        if (st === "failed" || st === "disconnected" || st === "closed") stop();
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // GA WebRTC endpoint — the model is bound to the ephemeral key, so no
      // ?model= query is needed.
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        throw new Error(`Realtime SDP exchange failed (${sdpRes.status})`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start voice session");
      setStatus("error");
      teardown();
    }
  }

  const connecting = status === "connecting";
  const live = status === "live";

  return (
    <div className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
        <span className="text-sm font-medium text-[#0C4A6E]" role="status" aria-live="polite">
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={start}
          disabled={connecting || live}
          className="px-4 py-2 text-sm font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {connecting ? "Connecting…" : "Start voice check"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={status === "idle"}
          className="px-4 py-2 text-sm font-medium text-[#0C4A6E] bg-white border border-[#E2E8F0] rounded-lg cursor-pointer hover:bg-[#F0F9FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          End
        </button>
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
