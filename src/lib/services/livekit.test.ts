import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { mockCreateRoom, mockToJwt, mockAddGrant, mockAccessToken, mockCreateDispatch } =
  vi.hoisted(() => ({
    mockCreateRoom: vi.fn(),
    mockToJwt: vi.fn(async () => "jwt-abc"),
    mockAddGrant: vi.fn(),
    mockCreateDispatch: vi.fn(),
    mockAccessToken: vi.fn(function () {
      return { addGrant: mockAddGrant, toJwt: mockToJwt };
    }),
  }));

vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: vi.fn(function () {
    return { createRoom: mockCreateRoom };
  }),
  AgentDispatchClient: vi.fn(function () {
    return { createDispatch: mockCreateDispatch };
  }),
  AccessToken: mockAccessToken,
}));

import {
  createScreeningRoomGrant,
  createInterviewRoomGrant,
  INTERVIEW_AGENT_NAME,
  SCREENING_AGENT_NAME,
} from "./livekit";

describe("createScreeningRoomGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToJwt.mockResolvedValue("jwt-abc");
    process.env.LIVEKIT_URL = "wss://demo.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "APIkey";
    process.env.LIVEKIT_API_SECRET = "secret";
  });

  /**
   * **LiveKit ships metadata to every participant**, so the interviewer's topic
   * guide that used to ride here was readable by the candidate's own browser
   * before a question was asked. The worker fetches that over the agent API
   * instead, and metadata carries only things the candidate already has.
   *
   * Asserted as an exact shape rather than a list of forbidden fields: the
   * failure being guarded against is a NEW field nobody thought to forbid.
   */
  it("puts nothing in metadata the candidate did not already have", async () => {
    await createScreeningRoomGrant({ applicationId: "app-1", language: "french" });

    expect(mockCreateRoom).toHaveBeenCalledTimes(1);
    const arg = mockCreateRoom.mock.calls[0][0];
    expect(arg.name).toMatch(/^screening-app-1-/);
    // The id is in their own signed token; the language is the choice they
    // made on the page a moment earlier. Nothing else may appear here.
    expect(JSON.parse(arg.metadata)).toEqual({ application_id: "app-1", language: "french" });
  });

  /** The room is created with the language, so a re-record can pick again. */
  it("carries the language the candidate picked", async () => {
    await createScreeningRoomGrant({ applicationId: "app-1", language: "english" });

    expect(JSON.parse(mockCreateRoom.mock.calls[0][0].metadata).language).toBe("english");
  });

  it("returns the server url, the room name, and a candidate-scoped join token", async () => {
    const grant = await createScreeningRoomGrant({ applicationId: "app-1", language: "english" });

    expect(grant.serverUrl).toBe("wss://demo.livekit.cloud");
    expect(grant.roomName).toMatch(/^screening-app-1-/);
    expect(grant.participantToken).toBe("jwt-abc");
    expect(mockAccessToken).toHaveBeenCalledWith(
      "APIkey",
      "secret",
      expect.objectContaining({ identity: "candidate-app-1" }),
    );
    expect(mockAddGrant).toHaveBeenCalledWith(
      expect.objectContaining({ roomJoin: true, room: grant.roomName }),
    );
  });

  it("scopes the token to exactly the created room (no wildcard join)", async () => {
    const grant = await createScreeningRoomGrant({ applicationId: "app-1", language: "english" });

    const grantArg = mockAddGrant.mock.calls[0][0];
    expect(grantArg.room).toBe(grant.roomName);
    expect(grantArg.roomCreate).toBeFalsy();
  });

  it("mints a fresh room per attempt so a re-record never reuses a stale agent", async () => {
    const a = await createScreeningRoomGrant({ applicationId: "app-1", language: "english" });
    const b = await createScreeningRoomGrant({ applicationId: "app-1", language: "english" });

    expect(a.roomName).not.toBe(b.roomName);
  });

  it("throws when LiveKit env vars are missing (explicit failure, no half-built grant)", async () => {
    delete process.env.LIVEKIT_API_SECRET;

    await expect(
      createScreeningRoomGrant({ applicationId: "app-1", language: "english" }),
    ).rejects.toThrow(/LIVEKIT/);
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });

  // Each flow summons exactly its own worker; a screening room must never pull
  // in the video interviewer.
  it("summons the screening agent by name, not the interview agent", async () => {
    const grant = await createScreeningRoomGrant({ applicationId: "app-1", language: "english" });

    expect(mockCreateDispatch).toHaveBeenCalledWith(grant.roomName, SCREENING_AGENT_NAME);
  });
});

describe("createInterviewRoomGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToJwt.mockResolvedValue("jwt-abc");
    process.env.LIVEKIT_URL = "wss://demo.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "APIkey";
    process.env.LIVEKIT_API_SECRET = "secret";
  });

  // Same rule as screening, and it bites harder here: the instructions embed
  // the candidate's résumé and the campaign's interviewing stance.
  it("puts the application id in metadata and nothing else", async () => {
    await createInterviewRoomGrant({ applicationId: "app-1" });

    const arg = mockCreateRoom.mock.calls[0][0];
    expect(arg.name).toMatch(/^interview-app-1-/);
    expect(JSON.parse(arg.metadata)).toEqual({ application_id: "app-1" });
  });

  it("grants the candidate camera + mic publish rights scoped to that room", async () => {
    const grant = await createInterviewRoomGrant({ applicationId: "app-1" });

    const grantArg = mockAddGrant.mock.calls[0][0];
    expect(grantArg).toMatchObject({
      room: grant.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(grantArg.roomCreate).toBeFalsy();
  });

  it("returns the server url, room name, and a minted join token", async () => {
    const grant = await createInterviewRoomGrant({ applicationId: "app-1" });

    expect(grant.serverUrl).toBe("wss://demo.livekit.cloud");
    expect(grant.roomName).toMatch(/^interview-app-1-/);
    expect(grant.participantToken).toBe("jwt-abc");
  });

  // Without this, the interview worker sits in the same automatic-dispatch pool
  // as the screening worker and LiveKit gives interview rooms to whichever it
  // picks — the "the interviewer didn't join" failure.
  it("summons the interview agent by name so the screening worker can't take the job", async () => {
    const grant = await createInterviewRoomGrant({ applicationId: "app-1" });

    expect(mockCreateDispatch).toHaveBeenCalledWith(grant.roomName, INTERVIEW_AGENT_NAME);
  });

  // Regression: a RoomConfiguration on the join token is silently ignored when
  // the room already exists, and we always createRoom first for the metadata.
  // Measured against a live LiveKit project: dispatch list empty, no agent ever
  // joined. The dispatch must be an explicit call against the created room.
  it("dispatches against the room it just created, not via the join token", async () => {
    const grant = await createInterviewRoomGrant({ applicationId: "app-1" });

    const createdRoom = mockCreateRoom.mock.calls[0][0].name;
    expect(createdRoom).toBe(grant.roomName);
    expect(mockCreateDispatch).toHaveBeenCalledWith(createdRoom, INTERVIEW_AGENT_NAME);
    expect(mockCreateRoom.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateDispatch.mock.invocationCallOrder[0],
    );
  });

  // A name only dispatches if the worker registered under the SAME string; the
  // workers are separate packages, so nothing but this check couples them.
  it("uses the names the agent workers actually register under", async () => {
    const workerSource = (name: string) =>
      readFileSync(join(process.cwd(), "agents", name, "src", "agent.ts"), "utf8");

    expect(workerSource("interview")).toContain(`agentName: INTERVIEW_AGENT_NAME`);
    expect(workerSource("interview")).toContain(
      `INTERVIEW_AGENT_NAME = "${INTERVIEW_AGENT_NAME}"`,
    );
    expect(workerSource("screening")).toContain(`agentName: SCREENING_AGENT_NAME`);
    expect(workerSource("screening")).toContain(
      `SCREENING_AGENT_NAME = "${SCREENING_AGENT_NAME}"`,
    );
  });

  it("throws when LiveKit env vars are missing", async () => {
    delete process.env.LIVEKIT_API_KEY;

    await expect(
      createInterviewRoomGrant({ applicationId: "app-1" }),
    ).rejects.toThrow(/LIVEKIT/);
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });
});
