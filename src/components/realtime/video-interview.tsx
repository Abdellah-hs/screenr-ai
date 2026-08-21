"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  displayLabels,
  parseOverlayPacket,
  placeBoxes,
  type OverlayBox,
  type OverlayDisplayLabel,
  type VideoGeometry,
} from "@/lib/proctoring/overlay";
import {
  AGENT_JOIN_TIMEOUT_MS,
  classifyStartFailure,
  diagnoseAgentSilence,
  realtimeTrace,
  type InterviewFailure,
} from "@/lib/realtime/interview-diagnostics";
import { INTERVIEW_DURATION_MINUTES } from "@/lib/constants";
import {
  CandidateShell,
  ShellIcon,
  SHELL_PRIMARY,
  SHELL_SECONDARY,
  type ShellTone,
} from "@/components/candidate/candidate-shell";
import { cn } from "@/lib/utils";

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

const STATUS_TONE: Record<Status, ShellTone> = {
  idle: "idle",
  connecting: "busy",
  live: "live",
  review: "info",
  submitting: "busy",
  done: "live",
  error: "idle",
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

const BOX_STYLE: Record<OverlayDisplayLabel, { box: string; chip: string; text: string }> = {
  face: { box: "border-[#22C55E]", chip: "bg-[#22C55E]", text: "Face detected" },
  second_face: { box: "border-[#F59E0B]", chip: "bg-[#F59E0B]", text: "Second face" },
  phone: { box: "border-[#F59E0B]", chip: "bg-[#F59E0B]", text: "Phone" },
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

  const labels = displayLabels(boxes);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {placeBoxes(boxes, geometry).map((box, i) => {
        const style = BOX_STYLE[labels[i]];
        return (
          <div
            key={`${labels[i]}-${i}`}
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
              {style.text}
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
/** One promise, ticked. Used only in the pre-call list. */
function Assurance({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-[11px] text-sm leading-[1.5] text-[#374151]">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export default function VideoInterview({
  token,
  campaignTitle,
  expiresAt,
}: VideoInterviewProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<InterviewFailure | null>(null);
  // Surfaced to the candidate, not only to the report: someone whose camera cut
  // out needs to know the call is still running and their answers still count.
  const [cameraOff, setCameraOff] = useState(false);
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
      setFailure(classifyStartFailure(null, "insecure"));
      setStatus("error");
      return;
    }
    setError(null);
    setFailure(null);
    setCameraOff(false);
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
          setCameraOff(true);
        }
      });

      room.on(RoomEvent.TrackUnmuted, (pub: TrackPublication, participant: Participant) => {
        if (isLocalCamera(pub, participant)) {
          proctoringRef.current.end("camera_off", Date.now());
          setCameraOff(false);
        }
      });

      room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
        if (proctoringActiveRef.current && pub.kind === Track.Kind.Video) {
          proctoringRef.current.begin("camera_off", Date.now());
          setCameraOff(true);
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
          realtimeTrace("video-interview", "candidate message", message);
          setFailure(classifyStartFailure(null, "interviewer"));
          setStatus("error");
        }, AGENT_JOIN_TIMEOUT_MS);
      }

      wasLiveRef.current = true;
      proctoringActiveRef.current = true;
      setStatus("live");
      startTimer();
    } catch (e) {
      teardown();
      setFailure(classifyStartFailure(e));
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
    setFailure(null);
    setCameraOff(false);
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
  const onStage = live || connecting;

  const shell = {
    label: STATUS_LABEL[status],
    tone: STATUS_TONE[status],
    clock: live ? formatClock(secondsLeft) : undefined,
    clockUrgent: lowTime,
  };

  // Desktop-only gate — shown whenever the device isn't a desktop, before any
  // room is opened. Never blocks a call already in progress on a resize down.
  if (!isDesktop && status === "idle") {
    return (
      <CandidateShell title="Video interview" role={campaignTitle}>
        <ShellIcon tone="warn">
          <Icon d="M9.75 17h4.5m-6.75 3h9a1.5 1.5 0 0 0 1.5-1.5v-15A1.5 1.5 0 0 0 15.75 2h-9A1.5 1.5 0 0 0 5.25 3.5v15A1.5 1.5 0 0 0 6.75 20Z" />
        </ShellIcon>
        <Heading>Please switch to a computer</Heading>
        <Body>
          This interview needs a camera and a steady setup. Open this same link on
          a computer in a quiet, well-lit room to begin
          {expiresAt ? (
            <>
              {" "}
              — your link stays valid until{" "}
              <strong className="font-semibold text-[#374151]">
                {formatDeadline(expiresAt)}
              </strong>
            </>
          ) : null}
          .
        </Body>
      </CandidateShell>
    );
  }

  if (status === "done") {
    return (
      <CandidateShell title="Video interview" role={campaignTitle}>
        <div className="text-center">
          <ShellIcon tone="good">
            <Icon d="m4.5 12.75 6 6 9-13.5" strokeWidth={2.2} />
          </ShellIcon>
          <h2 className="mb-2.5 font-heading text-[26px] font-semibold tracking-[-0.015em] text-ink">
            Thanks — that&apos;s everything
          </h2>
          <p className="mx-auto mb-6 max-w-[52ch] text-[15px] leading-[1.65] text-[#4B5563]">
            Your interview for{" "}
            <strong className="font-semibold text-ink">{campaignTitle}</strong> has
            been submitted. The hiring team will review it and be in touch by email.
          </p>
          <div className="mx-auto max-w-[52ch] rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-[18px] py-4 text-left">
            <p className="mb-1.5 text-[13px] font-semibold text-ink">
              What happens next
            </p>
            <p className="text-[13px] leading-[1.6] text-[#6B7280]">
              A person on the hiring team reads your transcript alongside your
              application and your earlier screening. You&apos;ll hear from them
              either way — usually within a week.
            </p>
          </div>
        </div>
      </CandidateShell>
    );
  }

  // A missed deadline is not a rejection, and a candidate staring at a dead link
  // will assume it was one unless told otherwise.
  //
  // Only before they start. A deadline that passes mid-call must not swallow a
  // finished interview: someone who was talking when the clock rolled over
  // still gets their review step and their Submit button.
  if (expired && (status === "idle" || status === "error")) {
    return (
      <CandidateShell title="Video interview" role={campaignTitle}>
        <ShellIcon tone="bad">
          <Icon d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </ShellIcon>
        <Heading>This interview link has expired</Heading>
        <Body>
          Interview links stay open for seven days. Nothing you did is lost, and
          this does not count against you. Reply to the email we sent you and a
          person will send a fresh link.
        </Body>
      </CandidateShell>
    );
  }

  if (status === "error") {
    // Never a dead end: a status of "error" with nothing classified still owes
    // the candidate a sentence and a way to try again.
    const shown = failure ?? classifyStartFailure(error ? new Error(error) : null);
    const soft = shown.kind === "permission" || shown.kind === "no_camera";
    return (
      <CandidateShell title="Video interview" role={campaignTitle} status={shell}>
        <ShellIcon tone={soft ? "warn" : "bad"}>
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
    <CandidateShell title="Video interview" role={campaignTitle} status={shell}>
      {status === "idle" && (
        <>
          <ShellIcon tone="neutral">
            <Icon d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </ShellIcon>

          <p className="mx-auto mb-5 max-w-[56ch] text-[17px] leading-[1.65] text-[#374151] text-pretty">
            An interview led by our AI interviewer — about{" "}
            <strong className="font-semibold text-ink">
              {INTERVIEW_DURATION_MINUTES} minutes
            </strong>
            . When you start, allow camera and microphone access, and the
            interviewer will greet you and ask questions based on your background.
            Speak naturally — you&apos;ll be able to review before submitting.
          </p>

          {/* Said before the call, not after. "No video is recorded" is the one
              a candidate most needs to hear while a camera light is about to
              come on, and it is a real property of this product. */}
          <ul className="mx-auto mb-5 flex max-w-[56ch] flex-col gap-[11px]">
            <Assurance>
              No video is recorded — the camera is used live and only a written
              transcript is kept.
            </Assurance>
            <Assurance>
              You can restart before submitting. Nothing is sent until you press
              submit.
            </Assurance>
            <Assurance>A person reads everything before any decision is made.</Assurance>
          </ul>

          {/* Monitoring is disclosed before consent, not discovered after it. */}
          <div
            role="note"
            className="mx-auto mb-6 max-w-[56ch] rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[17px] py-[15px]"
          >
            <p className="mb-2 flex items-center gap-[9px] text-sm font-semibold text-[#92400E]">
              <Icon
                className="h-4 w-4"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
              Before you start
            </p>
            <p className="text-[13px] leading-[1.65] text-[#92400E]">
              Sit in a quiet, well-lit room with your face clearly visible, close
              other tabs and apps, and use headphones with a mic if you have them.
              Please stay on this tab and keep your camera on for the whole
              interview —{" "}
              <strong className="font-semibold">
                leaving the tab or turning off your camera is noted for the hiring
                team.
              </strong>
            </p>
          </div>

          <button type="button" onClick={start} className={SHELL_PRIMARY}>
            <Icon
              className="h-[18px] w-[18px]"
              d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z"
            />
            Start interview
          </button>
          <Deadline expiresAt={expiresAt} />
        </>
      )}

      {/* One stage element across connecting and live: remounting the <video>
          would drop the camera track already attached to it. */}
      {onStage && (
        <>
          <div className="relative mb-3.5 aspect-video overflow-hidden rounded-[14px] bg-[#0F172A]">
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

            <span className="absolute left-3.5 top-3.5 inline-flex items-center gap-[7px] rounded-full bg-black/50 px-[11px] py-[5px] text-xs font-medium text-white">
              <span
                className={`h-2 w-2 rounded-full ${
                  connecting
                    ? "bg-[#FBBF24] motion-safe:animate-pulse"
                    : cameraOff
                      ? "bg-[#FBBF24]"
                      : "bg-[#EF4444] motion-safe:animate-pulse"
                }`}
                aria-hidden="true"
              />
              {connecting
                ? "Starting camera"
                : cameraOff
                  ? "Camera off"
                  : "Live · your camera"}
            </span>

            {live && (
              <span className="absolute right-3.5 top-3.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white/85">
                Not recorded
              </span>
            )}
          </div>

          {connecting ? (
            <>
              <p className="mb-1.5 text-center text-[17px] font-semibold text-ink">
                Connecting you now
              </p>
              <p className="mx-auto max-w-[52ch] text-center text-sm leading-[1.6] text-[#6B7280]">
                If your browser asks for the camera and microphone, choose{" "}
                <strong className="font-semibold text-[#374151]">Allow</strong>. The
                interviewer will say hello first.
              </p>
            </>
          ) : (
            <p className="mb-[18px] text-center text-xs leading-[1.55] text-[#9CA3AF]">
              The box is what the camera sees right now. It&apos;s shown to you
              live, and never used to score you.
            </p>
          )}
        </>
      )}

      {/* The one failure the code always knew about and never told the person it
          was happening to. */}
      {live && cameraOff && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[15px] py-[13px]"
        >
          <p className="text-[13px] leading-[1.55] text-[#92400E]">
            <strong className="font-semibold">Your camera is off.</strong> The call
            keeps running and your answers still count. Turn it back on when you
            can — the gap is noted for the hiring team, with how long it lasted,
            for a person to read.
          </p>
        </div>
      )}

      {/* Autoplay unlock prompt. The interview keeps running while this shows —
          the captions carry the question, so nothing is missed if you tap late. */}
      {onStage && audioBlocked && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[15px] py-[13px]"
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
      )}

      {live && (
        <>
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

          <p className="mb-5 text-center text-[13px] text-[#6B7280]">
            {hasResponses
              ? `${responseCount} ${responseCount === 1 ? "response" : "responses"} captured so far.`
              : "Nothing captured yet — the interviewer will start the questions."}
          </p>

          <button
            type="button"
            onClick={finish}
            className={cn(SHELL_SECONDARY, "min-h-[54px] text-base")}
          >
            I&apos;m finished
          </button>
          <p className="mt-3 text-center text-[13px] leading-[1.55] text-[#9CA3AF]">
            Take your time. The interview ends by itself at{" "}
            {formatClock(CALL_SECONDS)} and you&apos;ll still be able to submit.
          </p>
        </>
      )}

      {review && (
        <>
          <ShellIcon tone="info">
            <Icon d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </ShellIcon>

          {timedOut && (
            <Heading>Your {INTERVIEW_DURATION_MINUTES} minutes are up</Heading>
          )}

          {hasResponses ? (
            <>
              {!timedOut && <Heading>That&apos;s the interview done</Heading>}
              <p className="mx-auto mb-[22px] max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
                We captured{" "}
                <strong className="font-semibold text-ink">
                  {responseCount} {responseCount === 1 ? "response" : "responses"}
                </strong>
                . Submit when you&apos;re ready, or restart if you&apos;d like to
                redo the interview — nothing has been sent yet.
              </p>
            </>
          ) : (
            <>
              {!timedOut && <Heading>We didn&apos;t catch any answers</Heading>}
              <p className="mx-auto mb-[22px] max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
                That usually means the microphone wasn&apos;t picking you up.
                Please restart before submitting — an empty interview would leave
                the team nothing to read.
              </p>
            </>
          )}

          <div className="flex flex-col items-center gap-2.5">
            {/* An empty interview is never submittable: a blank transcript
                reaching the team helps nobody, least of all the candidate. */}
            {hasResponses && (
              <button type="button" onClick={submit} className={SHELL_PRIMARY}>
                Submit interview
              </button>
            )}
            <button type="button" onClick={restart} className={SHELL_SECONDARY}>
              Restart
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
            Saving your interview…
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

/** Centred 19px heading — every terminal state opens with one. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-center text-[19px] font-semibold text-ink">{children}</p>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mb-6 max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
      {children}
    </p>
  );
}

function Deadline({ expiresAt }: { expiresAt?: string }) {
  if (!expiresAt) return null;
  return (
    <p className="mt-3.5 text-center text-[13px] text-[#6B7280]">
      Please complete by{" "}
      <strong className="font-semibold text-[#374151]">
        {formatDeadline(expiresAt)}
      </strong>
      .
    </p>
  );
}

/** Heroicons outline, inline. One wrapper so stroke width and caps never drift. */
function Icon({
  d,
  className = "h-8 w-8",
  strokeWidth = 1.6,
}: {
  d: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
