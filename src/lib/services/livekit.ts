import { randomBytes } from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

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
 * id, the join token is scoped to exactly that room, and the screening
 * instructions travel in room metadata — which only the server (and the agent)
 * can read or set; the candidate cannot alter what they'll be asked.
 */

/** What the candidate's browser needs to join their screening call. */
export interface ScreeningRoomGrant {
  serverUrl: string;
  roomName: string;
  participantToken: string;
}

/** Metadata the agent worker reads off the room to run the interview. */
export interface ScreeningRoomMetadata {
  application_id: string;
  instructions: string;
}

/** A room with nobody in it closes itself after this many seconds. */
const EMPTY_ROOM_TIMEOUT_SECONDS = 5 * 60;

/** Candidate + agent; nobody else has a token, but cap it anyway. */
const MAX_PARTICIPANTS = 2;

/** Join tokens are minted right before connecting; keep them short-lived. */
const TOKEN_TTL = "15m";

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
  instructions: string;
}): Promise<ScreeningRoomGrant> {
  const serverUrl = requireEnv("LIVEKIT_URL");
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const roomName = `screening-${args.applicationId}-${randomBytes(4).toString("hex")}`;

  const metadata: ScreeningRoomMetadata = {
    application_id: args.applicationId,
    instructions: args.instructions,
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

  return {
    serverUrl,
    roomName,
    participantToken: await token.toJwt(),
  };
}
