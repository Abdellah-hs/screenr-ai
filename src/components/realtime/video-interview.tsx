"use client";

import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteParticipant,
  type LocalTrackPublication,
  type TrackPublication,
  type Participant,
} from "livekit-client";
import { startCandidateInterview, submitInterview } from "@/lib/actions/interview";
import { createProctoringCollector } from "@/lib/proctoring/collector";
import {
  OVERLAY_STALE_AFTER_MS,
  OVERLAY_TOPIC,
  parseOverlayPacket,
  placeBoxes,
  type OverlayBox,
  type OverlayBoxLabel,
  type VideoGeometry,
} from "@/lib/proctoring/overlay";
import {
  AGENT_JOIN_TIMEOUT_MS,
  diagnoseAgentSilence,
  realtimeTrace,
} from "@/lib/realtime/interview-diagnostics";
import { INTERVIEW_DURATION_MINUTES } from "@/lib/constants";

interface VideoInterviewProps {
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
  live: "Live — the interviewer can see and hear you",
  review: "Review before you submit",
  submitting: "Saving your interview…",
  done: "All done",
  error: "Something went wrong",
};

const STATUS_DOT: Record<Status, string> = {
  idle: "bg-[#9CA3AF]",
  connecting: "bg-amber-500 animate-pulse",
  live: "bg-green-500",
  review: "bg-[#2563EB]",
  submitting: "bg-amber-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
};

/** Hard cap on the live interview. When it hits 0 the call ends and the
 *  candidate is taken to the review step to submit. Derived from the shared
 *  constant so the cap, the copy below, and the interviewer's own pacing
 *  instructions can never disagree about how long this is. */
const CALL_SECONDS = INTERVIEW_DURATION_MINUTES * 60;

/** LiveKit publishes live transcription segments on this text-stream topic. */
const TRANSCRIPTION_TOPIC = "lk.transcription";

/**
 * The self-view is mirrored, because a preview that doesn't mirror feels wrong
 * to look at. One constant drives both the CSS and the overlay geometry — the
 * detector sees the unmirrored frame, so if these two ever disagree every box
 * lands on the wrong side.
 */
const SELF_VIEW_MIRRORED = true;

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

const BOX_STYLE: Record<OverlayBoxLabel, { box: string; chip: string; text: string }> = {
  person: {
    box: "border-[#22C55E]",
    chip: "bg-[#22C55E]",
    text: "Person",
  },
  phone: {
    box: "border-[#F59E0B]",
    chip: "bg-[#F59E0B]",
    text: "Phone",
  },
};

/**
 * Live detection boxes drawn over the candidate's self-view.
 *
 * Display only, and structurally incapable of being anything else: the boxes
 * arrive over the room's data channel, are drawn, and are dropped. The
 * proctoring report is assembled server-side from the worker's own readings, so
 * a candidate who blocks, replays, or forges these packets changes what they
 * see and nothing about what is recorded.
 *
 * Geometry is measured from the element rather than assumed, because
 * `object-fit: cover` crops the frame and the preview is mirrored — see
 * `placeBoxes`, which owns that maths and is tested on its own.
 */
function DetectionOverlay({
  videoRef,
  boxes,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  boxes: OverlayBox[];
}) {
  const [geometry, setGeometry] = useState<VideoGeometry | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    // Measuring reads clientWidth/Height, which forces layout, and setting a
    // fresh object would re-render even when nothing moved. So measure only on
    // events that can actually change the geometry, and keep the old object
    // when the numbers are unchanged.
    const measure = () => {
      const el = videoRef.current;
      const next: VideoGeometry | null =
        el && el.videoWidth && el.clientWidth
          ? {
              frameWidth: el.videoWidth,
              frameHeight: el.videoHeight,
              elementWidth: el.clientWidth,
              elementHeight: el.clientHeight,
              mirrored: SELF_VIEW_MIRRORED,
            }
          : null;

      setGeometry((current) => {
        if (current === next) return current;
        if (!current || !next) return next;
        return current.frameWidth === next.frameWidth &&
          current.frameHeight === next.frameHeight &&
          current.elementWidth === next.elementWidth &&
          current.elementHeight === next.elementHeight
          ? current
          : next;
      });
    };

    measure();
    window.addEventListener("resize", measure);
    video?.addEventListener("loadedmetadata", measure);
    // Fires when the track's intrinsic dimensions change mid-call — cheaper and
    // more precise than re-measuring on every packet.
    video?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      video?.removeEventListener("loadedmetadata", measure);
      video?.removeEventListener("resize", measure);
    };
  }, [videoRef]);

  if (!geometry || boxes.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {placeBoxes(boxes, geometry).map((box, i) => {
        const style = BOX_STYLE[box.label];
        return (
          <div
            key={`${box.label}-${i}`}
            className={`absolute rounded-md border-2 ${style.box} transition-all duration-300 ease-out`}
            style={{
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
          >
            <span
              className={`absolute -top-[1px] left-[-2px] -translate-y-full rounded-t px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ${style.chip}`}
            >
              {style.text} {Math.round(box.score * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Desktop-only: the AI interview requires a real keyboard/camera setup (PRD
 *  candidate-facing constraint). Coarse pointer or a narrow viewport → phone/
 *  tablet, which we block with a friendly switch-device message. */
function computeIsDesktop(): boolean {
  if (typeof window === "undefined") return true;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const narrow = window.innerWidth < 1024;
  return !coarse && !narrow;
}

const PRIMARY_BTN =
  "px-4 py-2 text-sm font-medium text-white bg-[#111827] rounded-lg cursor-pointer hover:bg-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Candidate-facing AI video interview on LiveKit. Mirrors the voice-screening
 * flow: the server action opens a room (résumé-grounded agent instructions live
 * in its metadata, out of the candidate's reach), this component joins with
 * camera + mic, and the server-side interview agent worker runs the interview
 * and reports the transcript to the app as the call progresses. The browser
 * never assembles or submits transcript content — on "Submit" it sends only the
 * token, and the server finalizes from the agent-reported draft.
 *
 * What the client adds over the voice flow: a camera self-view, a desktop-only
 * gate, and a longer call cap.
 */
export default function VideoInterview({
  token,
  campaignTitle,
  expiresAt,
}: VideoInterviewProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [responseCount, setResponseCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(CALL_SECONDS);
  const [timedOut, setTimedOut] = useState(false);
  const [caption, setCaption] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  // Live detection boxes drawn over the self-view. Display only — they are never
  // sent back, and the proctoring report is built server-side from the worker's
  // own readings regardless of what happens here.
  const [overlayBoxes, setOverlayBoxes] = useState<OverlayBox[]>([]);
  // Starts optimistic (true) so SSR/first paint doesn't flash the block screen;
  // corrected on mount + resize.
  const [isDesktop, setIsDesktop] = useState(true);

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selfViewRef = useRef<HTMLVideoElement | null>(null);
  const wasLiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const candidateSegmentsRef = useRef<Set<string>>(new Set());
  // Interviewer-presence tracking for the silence watchdog: did the agent join
  // the room, and did its audio arrive? The watchdog reads these to pinpoint a
  // stall — "worker never joined" vs "agent joined but stayed mute".
  const agentPresentRef = useRef(false);
  const agentAudioRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Proctoring buffer (Phase C). Browser-only signals — tab focus and the local
  // camera — accumulated during the call and flushed once on submit. Severity is
  // decided server-side; this only reports what happened and for how long.
  const proctoringRef = useRef(createProctoringCollector());
  // Gates the camera-presence handlers. Ending the call unpublishes the camera
  // track, which would otherwise open a "camera off" gap that runs until submit
  // and reads as a critical incident against a candidate who did nothing wrong.
  const proctoringActiveRef = useRef(false);
  // When the last overlay packet arrived, so stale boxes can be cleared rather
  // than left hanging over a scene they no longer describe.
  const overlayAtRef = useRef(0);

  const expired = expiresAt ? Date.now() > Date.parse(expiresAt) : false;

  // Track desktop-ness on mount + resize.
  useEffect(() => {
    const update = () => setIsDesktop(computeIsDesktop());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Leave the room and stop the countdown on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearWatchdog();
      roomRef.current?.disconnect();
    };
  }, []);

  // Drop stale overlay boxes. If the worker stops publishing — it died, the data
  // channel dropped, the camera cut — the last packet's boxes would otherwise
  // hang frozen over a scene they no longer describe, which reads as the
  // detector being confidently wrong rather than simply absent.
  useEffect(() => {
    if (status !== "live") {
      setOverlayBoxes([]);
      return;
    }
    const sweep = setInterval(() => {
      if (Date.now() - overlayAtRef.current > OVERLAY_STALE_AFTER_MS) {
        setOverlayBoxes((current) => (current.length === 0 ? current : []));
      }
    }, 1_000);
    return () => clearInterval(sweep);
  }, [status]);

  // Proctoring: tab-focus tracking, armed only while the call is live so time
  // spent on the intro or review screens is never counted against the candidate.
  // `visibilitychange` catches tab switches and minimising; window blur catches
  // focus moving to another app or window on top of this one. Both open the same
  // condition and either one closing ends it — `begin`/`end` are idempotent, so
  // the pair firing together (as browsers usually do) still yields one interval.
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
      // The call is over — close any interval still open so it isn't left
      // dangling until drain.
      collector.end("tab_blur", Date.now());
    };
  }, [status]);

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

  function handleTimeUp() {
    setTimedOut(true);
    teardown();
    setStatus((s) => (s === "live" ? "review" : s));
  }

  function teardown() {
    stopTimer();
    clearWatchdog();
    // Close proctoring BEFORE disconnecting, so a genuine gap in progress is
    // recorded with its real end time and the disconnect's own unpublish event
    // is ignored.
    proctoringActiveRef.current = false;
    proctoringRef.current.end("camera_off", Date.now());
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
  }

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
    realtimeTrace("video-interview", "interviewer audio attached");
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
        "Your browser can't access the camera and microphone on this page. It needs a secure connection — open this link over https, or on this computer use http://localhost:3000.",
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
    // Discard anything buffered by an earlier attempt — each attempt is proctored
    // on its own, and only the submitted one is reported.
    proctoringRef.current.drain(Date.now());
    clearWatchdog();
    try {
      const grant = await startCandidateInterview(token);

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
        realtimeTrace("video-interview", "interviewer joined", p.identity);
      });

      // Self-view: attach the candidate's own camera track once it publishes.
      room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
        if (pub.track?.kind === Track.Kind.Video && selfViewRef.current) {
          pub.track.attach(selfViewRef.current);
        }
        // A republished camera closes any open gap (device recovered, or the
        // candidate re-enabled it).
        if (proctoringActiveRef.current && pub.kind === Track.Kind.Video) {
          proctoringRef.current.end("camera_off", Date.now());
        }
      });

      // Proctoring presence. V1 measures camera AVAILABILITY, not face
      // detection: a muted, stopped, or unpublished video track is the reliable,
      // model-free signal that the interviewer can no longer see the candidate.
      // True face/gaze analysis is a later slice — the report shape already
      // accommodates it without a schema change.
      const isLocalCamera = (pub: TrackPublication, participant: Participant) =>
        proctoringActiveRef.current &&
        participant.identity === room.localParticipant.identity &&
        pub.kind === Track.Kind.Video;

      room.on(RoomEvent.TrackMuted, (pub: TrackPublication, participant: Participant) => {
        if (isLocalCamera(pub, participant)) {
          proctoringRef.current.begin("camera_off", Date.now());
        }
      });

      room.on(RoomEvent.TrackUnmuted, (pub: TrackPublication, participant: Participant) => {
        if (isLocalCamera(pub, participant)) {
          proctoringRef.current.end("camera_off", Date.now());
        }
      });

      room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
        if (proctoringActiveRef.current && pub.kind === Track.Kind.Video) {
          proctoringRef.current.begin("camera_off", Date.now());
        }
      });

      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioBlocked(!room.canPlaybackAudio);
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current) {
          teardown();
          setStatus((s) =>
            s === "review" || s === "submitting" || s === "done" ? s : "idle",
          );
        }
      });

      // Detection boxes from the agent worker's proctoring pass. Display only:
      // nothing here feeds the report, which is assembled server-side from the
      // worker's own readings — a candidate blocking or faking these packets
      // changes what they see, not what is recorded about them.
      room.on(
        RoomEvent.DataReceived,
        (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
          if (topic !== OVERLAY_TOPIC) return;
          const packet = parseOverlayPacket(payload);
          if (!packet) return;
          overlayAtRef.current = Date.now();
          setOverlayBoxes(packet.boxes);
        },
      );

      // Live transcription segments, published by the agent for both sides.
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
      realtimeTrace("video-interview", "room connected; awaiting interviewer");

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
        await room.localParticipant.setCameraEnabled(true);
      } catch {
        throw new Error(
          "We couldn't turn on your camera and microphone. Please allow access in your browser and try again.",
        );
      }

      // The "Start interview" click is a live user gesture — unlock audio now.
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
            `[video-interview] interviewer silent after ${AGENT_JOIN_TIMEOUT_MS}ms (reason=${reason}). ${devHint}`,
          );
          teardown();
          setError(message);
          setStatus("error");
        }, AGENT_JOIN_TIMEOUT_MS);
      }

      wasLiveRef.current = true;
      proctoringActiveRef.current = true;
      setStatus("live");
      startTimer();
    } catch (e) {
      teardown();
      setError(e instanceof Error ? e.message : "Failed to start the interview.");
      setStatus("error");
    }
  }

  function finish() {
    teardown();
    if (!wasLiveRef.current) {
      setStatus("idle");
      return;
    }
    setStatus("review");
  }

  function restart() {
    teardown();
    setResponseCount(0);
    setSecondsLeft(CALL_SECONDS);
    setTimedOut(false);
    setCaption("");
    setAudioBlocked(false);
    candidateSegmentsRef.current = new Set();
    wasLiveRef.current = false;
    proctoringRef.current.drain(Date.now());
    setError(null);
    setStatus("idle");
  }

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
    // Flush the proctoring buffer alongside the submit — one write, at the end,
    // rather than chatter during the call. The server bounds and classifies it.
    const proctoringEvents = proctoringRef.current.drain(Date.now());
    try {
      await submitInterview({ token, proctoringEvents });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your interview.");
      setStatus("review");
    }
  }

  const connecting = status === "connecting";
  const live = status === "live";
  const review = status === "review";
  const submitting = status === "submitting";
  const hasResponses = responseCount > 0;
  const lowTime = secondsLeft <= 60;

  // Desktop-only gate — shown whenever the device isn't a desktop, before any
  // room is opened. Never blocks a call already in progress on a resize down.
  if (!isDesktop && status === "idle") {
    return (
      <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-6 w-6 text-[#B45309]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17h4.5m-6.75 3h9a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0015.75 2h-9A1.5 1.5 0 005.25 3.5v15A1.5 1.5 0 006.75 20z" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[#111827]">Please switch to a computer</h2>
        <p className="text-sm text-[#92400E]">
          This video interview for <strong>{campaignTitle}</strong> needs a desktop or laptop with
          a camera. Open this same link on a computer in a quiet, well-lit room to begin.
        </p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[#111827]">Thanks — that&apos;s everything</h2>
        <p className="text-sm text-[#6B7280]">
          Your interview for <strong>{campaignTitle}</strong> has been recorded. The hiring team
          will review it and be in touch by email.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#E5E7EB] bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
          <span className="text-sm font-medium text-[#374151]" role="status" aria-live="polite">
            {STATUS_LABEL[status]}
          </span>
        </div>
        {live && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${
              lowTime ? "bg-red-50 text-red-600" : "bg-[#F3F4F6] text-[#374151]"
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
            This is an AI-led video interview for <strong>{campaignTitle}</strong> — about{" "}
            <strong>{INTERVIEW_DURATION_MINUTES} minutes</strong>. When you start, allow camera and microphone access, and
            the interviewer will greet you and ask questions based on your background. Speak
            naturally — you&apos;ll be able to review before submitting.
          </p>

          <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3" role="note">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs leading-relaxed text-[#92400E]">
              <strong>Find a quiet, well-lit room before you start.</strong> Sit facing a light
              source with your face clearly visible, close other tabs and apps, and use headphones
              with a mic if you have them. Please stay on this tab and keep your camera on for the
              whole interview — leaving the tab or turning off your camera is noted for the hiring
              team.
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

      {/* Video stage — dark panel with the candidate's self-view. */}
      {(live || connecting) && (
        <div className="relative overflow-hidden rounded-xl bg-[#0F172A] aspect-video">
          <video
            ref={selfViewRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${
              SELF_VIEW_MIRRORED ? "[transform:scaleX(-1)]" : ""
            }`}
          />
          <DetectionOverlay videoRef={selfViewRef} boxes={overlayBoxes} />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white">
            <span className={`inline-block h-2 w-2 rounded-full ${live ? "bg-red-500" : "bg-amber-400 animate-pulse"}`} aria-hidden />
            You
          </span>
        </div>
      )}

      {/* Autoplay unlock prompt. */}
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

      {/* Live captions of the interviewer's questions. */}
      {(live || connecting) && (
        <div className="rounded-lg border border-[#C7D2FE] bg-[#FAFAFF] p-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#4338CA]">
            Interviewer
          </p>
          <p className="min-h-[1.5rem] text-sm leading-relaxed text-[#374151]" aria-live="polite">
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
        <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
          {timedOut && (
            <p className="mb-1 text-sm font-medium text-[#374151]">
              Your {INTERVIEW_DURATION_MINUTES} minutes are up.
            </p>
          )}
          {hasResponses ? (
            <p className="text-sm text-[#374151]">
              We captured <strong>{responseCount}</strong> spoken{" "}
              {responseCount === 1 ? "response" : "responses"}. Submit when you&apos;re ready, or
              restart if you&apos;d like to redo the interview.
            </p>
          ) : (
            <p className="text-sm text-[#374151]">
              We didn&apos;t catch any spoken answers. Please restart before submitting.
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
            Submit interview
          </button>
        )}
        {review && (
          <button
            type="button"
            onClick={restart}
            className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 transition-colors duration-200"
          >
            Restart
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
