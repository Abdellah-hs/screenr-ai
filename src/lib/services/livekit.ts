import { randomBytes } from "node:crypto";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import type { CallLanguage } from "@/lib/constants";

/**
 * LiveKit room service for the candidate voice screening.
 *
 * The browser no longer dials OpenAI directly (the old spike): the candidate
 * joins a LiveKit room, and a server-side agent worker (see `agents/screening/`)
 * joins the same room, runs the OpenAI Realtime conversation, and reports the
 * transcript back to the app — so the transcript is produced on OUR side, not
 * assembled by the candidate's browser.
 *
 * Trust model: this module is only ever called AFTER the action layer verified
 * the candidate's signed screening token. The room name embeds the application
 * id and the join token is scoped to exactly that room.
 *
 * **Room metadata is candidate-VISIBLE. Put nothing confidential in it.**
 * Only the server can SET it, so a candidate cannot alter what they will be
 * asked — but LiveKit delivers metadata to every participant: it arrives in the
 * JOIN response and is exposed as `room.metadata` on the client SDK. Until
 * 2026-08-24 the interviewer instructions travelled here, which meant a
 * candidate with the network tab open read the whole confidential topic guide
 * before being asked anything, defeating "questions never shown in advance"
 * (docs/voice-screening.md, mitigation #2) — and, on the interview side,
 * handed them the campaign's interviewing stance.
 *
 * The metadata now carries the application id alone. Each worker fetches its
 * own instructions from `GET /api/agent/{screening,interview}/instructions`,
 * guarded by `AGENT_API_SECRET` — the same secret it already holds to report
 * transcripts, so the boundary gained no new trust.
 *
 * **Deploy order matters.** A worker that still expects instructions in
 * metadata finds none and leaves, stranding the candidate in a silent room, so
 * the workers under `agents/` must be restarted BEFORE this app is deployed.
 * They fetch first and fall back to metadata, so a new worker runs against
 * either version of the app; an old worker does not.
 */

/** What the candidate's browser needs to join their screening call. */
export interface ScreeningRoomGrant {
  serverUrl: string;
  roomName: string;
  participantToken: string;
}

/**
 * Metadata the agent worker reads off the room.
 *
 * The application id and nothing else — see the trust model above. It is the
 * one thing that has to be here (the worker has no other way to learn which
 * application it was dispatched for) and the one thing that costs nothing to
 * expose: the candidate's own signed token already encodes it.
 */
export interface ScreeningRoomMetadata {
  application_id: string;
  /**
   * The language the candidate chose before starting, for the worker to speak.
   *
   * **The second thing metadata carries, and the exception is deliberate.** The
   * rule is "the application id and nothing else", because LiveKit delivers
   * metadata to every participant — which is how the confidential topic guide
   * once leaked to the candidate's browser. This one costs nothing to expose
   * for the same reason the id does: it came FROM that browser seconds earlier.
   * It is the candidate's own choice being handed back.
   *
   * It belongs on the ROOM rather than on the application: a re-record is a new
   * call, and somebody who picked the wrong language should get to pick again
   * by starting over.
   *
   * A closed enum, never free text, because it ends up inside the interviewer's
   * own instructions.
   */
  language: CallLanguage;
}

/**
 * What the candidate's browser needs to join their AI video interview. Same
 * shape as the screening grant — the difference is on the client (it publishes
 * camera + mic, not mic alone) and in the room name prefix the interview agent
 * worker keys off.
 */
export type InterviewRoomGrant = ScreeningRoomGrant;

/**
 * Metadata the interview agent worker reads off the room.
 *
 * **No longer an alias of the screening one.** The screening room carries the
 * candidate's language choice as well, because they pick it on the page before
 * the call; the AI interview has no such choice, and a field the interview
 * worker never reads would be one more thing sitting in metadata that LiveKit
 * hands to every participant.
 */
export interface InterviewRoomMetadata {
  application_id: string;
}

/** A room with nobody in it closes itself after this many seconds. */
const EMPTY_ROOM_TIMEOUT_SECONDS = 5 * 60;

/** Candidate + agent; nobody else has a token, but cap it anyway. */
const MAX_PARTICIPANTS = 2;

/** Join tokens are minted right before connecting; keep them short-lived. */
const TOKEN_TTL = "15m";

/** An interview runs longer than a screening; give the join token more room. */
const INTERVIEW_TOKEN_TTL = "45m";

/**
 * Registered names of the two agent workers under `agents/`, which are
 * dispatched EXPLICITLY — each room summons exactly the worker it needs.
 *
 * Both workers were previously unnamed, which in LiveKit means *automatic*
 * dispatch: every worker in that pool is a candidate for every room in the
 * project. With two different agents sharing one pool, LiveKit handed each new
 * room to whichever it picked, so roughly half of all interviews went to the
 * screening worker — which saw the `interview-` prefix, left, and stranded the
 * candidate with "the interviewer didn't join". Naming both removes the pool
 * entirely; it also stops the other worker from consuming one of the room's two
 * participant slots before it realises the room isn't its own.
 *
 * Changing a name requires restarting that worker, or its flow gets no agent.
 */
export const INTERVIEW_AGENT_NAME = "screenr-interview";
export const SCREENING_AGENT_NAME = "screenr-screening";

/**
 * Summon a named worker into a room that already exists.
 *
 * It must be an explicit dispatch call. A `RoomConfiguration` attached to the
 * candidate's join token does NOT work here: that only takes effect when the
 * join itself creates the room, and we always `createRoom` first to attach the
 * instructions metadata. Measured — with the token carrying a valid dispatch
 * request, the room's dispatch list came back empty and no agent ever joined.
 *
 * Throws rather than failing quietly: a room with no interviewer in it is
 * useless, and surfacing it now beats leaving the candidate watching a silent
 * screen until the client's join timeout gives up.
 */
async function dispatchAgent(
  args: { serverUrl: string; apiKey: string; apiSecret: string },
  roomName: string,
  agentName: string,
): Promise<void> {
  const dispatchClient = new AgentDispatchClient(
    args.serverUrl,
    args.apiKey,
    args.apiSecret,
  );
  await dispatchClient.createDispatch(roomName, agentName);
}

function requireEnv(name: "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/**
 * Create a fresh room for one screening attempt and mint the candidate's join
 * token for it. Per-attempt rooms (random suffix) keep re-records clean: every
 * "Start interview" gets a new room, a new agent job, and a clean conversation
 * — the transcript draft the agent reports simply overwrites the previous
 * attempt's.
 */
export async function createScreeningRoomGrant(args: {
  applicationId: string;
  /** Validated by the caller; the room is created with it and cannot change. */
  language: CallLanguage;
}): Promise<ScreeningRoomGrant> {
  const serverUrl = requireEnv("LIVEKIT_URL");
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const roomName = `screening-${args.applicationId}-${randomBytes(4).toString("hex")}`;

  const metadata: ScreeningRoomMetadata = {
    application_id: args.applicationId,
    language: args.language,
  };

  // RoomServiceClient talks HTTP; it accepts the wss:// url and rewrites it.
  const rooms = new RoomServiceClient(serverUrl, apiKey, apiSecret);
  await rooms.createRoom({
    name: roomName,
    metadata: JSON.stringify(metadata),
    emptyTimeout: EMPTY_ROOM_TIMEOUT_SECONDS,
    maxParticipants: MAX_PARTICIPANTS,
  });

  const token = new AccessToken(apiKey, apiSecret, {
    identity: `candidate-${args.applicationId}`,
    ttl: TOKEN_TTL,
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    // Text/data is how live captions reach the candidate; publishing data is
    // harmless (the agent ignores candidate data), but room admin is not granted.
    canPublishData: true,
  });

  // Summon the screening worker by name — never the interview worker.
  await dispatchAgent({ serverUrl, apiKey, apiSecret }, roomName, SCREENING_AGENT_NAME);

  return {
    serverUrl,
    roomName,
    participantToken: await token.toJwt(),
  };
}

/**
 * Create a fresh room for one AI video-interview attempt and mint the
 * candidate's join token. Mirrors `createScreeningRoomGrant` — the interview
 * agent worker keys off the `interview-` room-name prefix, the worker fetches
 * its own (résumé-grounded) instructions rather than reading them off the
 * room, and
 * the same `canPublish` grant covers the candidate's camera as well as their
 * mic. The token gets a longer TTL because an interview runs longer than a
 * screening call (`screeningCallMinutes`, 5-10 minutes depending on how many
 * topics the rubric produced).
 */
export async function createInterviewRoomGrant(args: {
  applicationId: string;
}): Promise<InterviewRoomGrant> {
  const serverUrl = requireEnv("LIVEKIT_URL");
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const roomName = `interview-${args.applicationId}-${randomBytes(4).toString("hex")}`;

  const metadata: InterviewRoomMetadata = { application_id: args.applicationId };

  const rooms = new RoomServiceClient(serverUrl, apiKey, apiSecret);
  await rooms.createRoom({
    name: roomName,
    metadata: JSON.stringify(metadata),
    emptyTimeout: EMPTY_ROOM_TIMEOUT_SECONDS,
    maxParticipants: MAX_PARTICIPANTS,
  });

  const token = new AccessToken(apiKey, apiSecret, {
    identity: `candidate-${args.applicationId}`,
    ttl: INTERVIEW_TOKEN_TTL,
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    // canPublish covers all track kinds, so the candidate publishes camera +
    // mic; the client decides which tracks to enable.
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // Summon the interview worker by name. This fires as the grant is minted, so
  // the agent is already joining while the browser connects; an abandoned link
  // leaves it briefly alone in the room until `emptyTimeout` closes it.
  await dispatchAgent({ serverUrl, apiKey, apiSecret }, roomName, INTERVIEW_AGENT_NAME);

  return {
    serverUrl,
    roomName,
    participantToken: await token.toJwt(),
  };
}
