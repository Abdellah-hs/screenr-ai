import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface FakeToken {
  addGrant: typeof mockAddGrant;
  toJwt: typeof mockToJwt;
  roomConfig?: { agents: { agentName: string }[] };
}

const { mockCreateRoom, mockToJwt, mockAddGrant, mockAccessToken, issuedTokens } = vi.hoisted(
  () => {
    const mockCreateRoom = vi.fn();
    const mockToJwt = vi.fn(async () => "jwt-abc");
    const mockAddGrant = vi.fn();
    const issuedTokens: Record<string, unknown>[] = [];
    const mockAccessToken = vi.fn(function () {
      const token = { addGrant: mockAddGrant, toJwt: mockToJwt };
      issuedTokens.push(token);
      return token;
    });
    return { mockCreateRoom, mockToJwt, mockAddGrant, mockAccessToken, issuedTokens };
  },
);

vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: vi.fn(function () {
    return { createRoom: mockCreateRoom };
  }),
  AccessToken: mockAccessToken,
  // Plain carriers — the real protobuf classes add nothing this test needs.
  RoomConfiguration: vi.fn(function (this: Record<string, unknown>, init: object) {
    Object.assign(this, init);
  }),
  RoomAgentDispatch: vi.fn(function (this: Record<string, unknown>, init: object) {
    Object.assign(this, init);
  }),
}));

/** The token minted by the most recent grant call. */
function lastToken(): FakeToken {
  return issuedTokens[issuedTokens.length - 1] as unknown as FakeToken;
}

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

  it("creates a per-attempt room carrying the application id and instructions in metadata", async () => {
    await createScreeningRoomGrant({
      applicationId: "app-1",
      instructions: "Interview the candidate.",
    });

    expect(mockCreateRoom).toHaveBeenCalledTimes(1);
    const arg = mockCreateRoom.mock.calls[0][0];
    expect(arg.name).toMatch(/^screening-app-1-/);
    expect(JSON.parse(arg.metadata)).toEqual({
      application_id: "app-1",
      instructions: "Interview the candidate.",
    });
  });

  it("returns the server url, the room name, and a candidate-scoped join token", async () => {
    const grant = await createScreeningRoomGrant({
      applicationId: "app-1",
      instructions: "x",
    });

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
    const grant = await createScreeningRoomGrant({
      applicationId: "app-1",
      instructions: "x",
    });

    const grantArg = mockAddGrant.mock.calls[0][0];
    expect(grantArg.room).toBe(grant.roomName);
    expect(grantArg.roomCreate).toBeFalsy();
  });

  it("mints a fresh room per attempt so a re-record never reuses a stale agent", async () => {
    const a = await createScreeningRoomGrant({ applicationId: "app-1", instructions: "x" });
    const b = await createScreeningRoomGrant({ applicationId: "app-1", instructions: "x" });

    expect(a.roomName).not.toBe(b.roomName);
  });

  it("throws when LiveKit env vars are missing (explicit failure, no half-built grant)", async () => {
    delete process.env.LIVEKIT_API_SECRET;

    await expect(
      createScreeningRoomGrant({ applicationId: "app-1", instructions: "x" }),
    ).rejects.toThrow(/LIVEKIT/);
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });

  // Each flow summons exactly its own worker; a screening room must never pull
  // in the video interviewer.
  it("summons the screening agent by name, not the interview agent", async () => {
    await createScreeningRoomGrant({ applicationId: "app-1", instructions: "x" });

    expect(lastToken().roomConfig?.agents).toEqual([
      expect.objectContaining({ agentName: SCREENING_AGENT_NAME }),
    ]);
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

  it("opens an interview-scoped room carrying the résumé-grounded instructions in metadata", async () => {
    await createInterviewRoomGrant({
      applicationId: "app-1",
      instructions: "Ask about their Stripe ledger work.",
    });

    const arg = mockCreateRoom.mock.calls[0][0];
    expect(arg.name).toMatch(/^interview-app-1-/);
    expect(JSON.parse(arg.metadata)).toEqual({
      application_id: "app-1",
      instructions: "Ask about their Stripe ledger work.",
    });
  });

  it("grants the candidate camera + mic publish rights scoped to that room", async () => {
    const grant = await createInterviewRoomGrant({
      applicationId: "app-1",
      instructions: "x",
    });

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
    const grant = await createInterviewRoomGrant({
      applicationId: "app-1",
      instructions: "x",
    });

    expect(grant.serverUrl).toBe("wss://demo.livekit.cloud");
    expect(grant.roomName).toMatch(/^interview-app-1-/);
    expect(grant.participantToken).toBe("jwt-abc");
  });

  // Without this, the interview worker sits in the same automatic-dispatch pool
  // as the screening worker and LiveKit gives interview rooms to whichever it
  // picks — the "the interviewer didn't join" failure.
  it("summons the interview agent by name so the screening worker can't take the job", async () => {
    await createInterviewRoomGrant({ applicationId: "app-1", instructions: "x" });

    expect(lastToken().roomConfig?.agents).toEqual([
      expect.objectContaining({ agentName: INTERVIEW_AGENT_NAME }),
    ]);
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
      createInterviewRoomGrant({ applicationId: "app-1", instructions: "x" }),
    ).rejects.toThrow(/LIVEKIT/);
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });
});
