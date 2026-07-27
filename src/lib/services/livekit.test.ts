import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateRoom, mockToJwt, mockAddGrant, mockAccessToken } = vi.hoisted(() => {
  const mockCreateRoom = vi.fn();
  const mockToJwt = vi.fn(async () => "jwt-abc");
  const mockAddGrant = vi.fn();
  const mockAccessToken = vi.fn(function () {
    return { addGrant: mockAddGrant, toJwt: mockToJwt };
  });
  return { mockCreateRoom, mockToJwt, mockAddGrant, mockAccessToken };
});

vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: vi.fn(function () {
    return { createRoom: mockCreateRoom };
  }),
  AccessToken: mockAccessToken,
}));

import { createScreeningRoomGrant, createInterviewRoomGrant } from "./livekit";

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

  it("throws when LiveKit env vars are missing", async () => {
    delete process.env.LIVEKIT_API_KEY;

    await expect(
      createInterviewRoomGrant({ applicationId: "app-1", instructions: "x" }),
    ).rejects.toThrow(/LIVEKIT/);
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });
});
