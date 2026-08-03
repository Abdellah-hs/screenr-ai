import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Swap only EgressClient; keep the real EncodedFileOutput / S3Upload / EncodedFileType
// protobuf classes so the test exercises the ACTUAL request we build for LiveKit.
const { mockStartEgress } = vi.hoisted(() => ({ mockStartEgress: vi.fn() }));

vi.mock("livekit-server-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-server-sdk")>();
  return {
    ...actual,
    EgressClient: class {
      startRoomCompositeEgress = mockStartEgress;
    },
  };
});

import { EncodedFileType } from "livekit-server-sdk";
import {
  interviewRecordingKey,
  isInterviewRecordingConfigured,
  startInterviewRecording,
} from "./livekit-egress";

const FULL_ENV: Record<string, string> = {
  LIVEKIT_URL: "wss://proj.livekit.cloud",
  LIVEKIT_API_KEY: "lk-key",
  LIVEKIT_API_SECRET: "lk-secret",
  SUPABASE_S3_ENDPOINT: "https://proj.supabase.co/storage/v1/s3",
  SUPABASE_S3_REGION: "us-east-1",
  SUPABASE_S3_ACCESS_KEY_ID: "s3-akid",
  SUPABASE_S3_SECRET_ACCESS_KEY: "s3-secret",
  INTERVIEW_RECORDING_BUCKET: "interview-recordings",
};

let savedEnv: NodeJS.ProcessEnv;

function applyEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = { ...process.env };
  mockStartEgress.mockResolvedValue({ egressId: "EG_abc123" });
});

afterEach(() => {
  process.env = savedEnv;
});

describe("interviewRecordingKey", () => {
  it("keys the object by campaign then application so the first path segment is the campaign id", () => {
    expect(interviewRecordingKey("camp-1", "app-1")).toBe("camp-1/app-1.mp4");
  });
});

describe("isInterviewRecordingConfigured", () => {
  it("is false when the Supabase S3 credentials are absent", () => {
    applyEnv({ ...FULL_ENV, SUPABASE_S3_ACCESS_KEY_ID: undefined });

    expect(isInterviewRecordingConfigured()).toBe(false);
  });

  it("is true once LiveKit and Supabase S3 are both configured", () => {
    applyEnv(FULL_ENV);

    expect(isInterviewRecordingConfigured()).toBe(true);
  });
});

describe("startInterviewRecording", () => {
  it("records the room to the Supabase S3 bucket as MP4 and returns the egress id + key", async () => {
    applyEnv(FULL_ENV);

    const handle = await startInterviewRecording({
      roomName: "interview-app-1-abcd",
      campaignId: "camp-1",
      applicationId: "app-1",
    });

    expect(mockStartEgress).toHaveBeenCalledTimes(1);
    const [roomName, output] = mockStartEgress.mock.calls[0];
    expect(roomName).toBe("interview-app-1-abcd");
    expect(output.filepath).toBe("camp-1/app-1.mp4");
    expect(output.fileType).toBe(EncodedFileType.MP4);
    expect(output.output.case).toBe("s3");
    expect(output.output.value).toMatchObject({
      bucket: "interview-recordings",
      endpoint: "https://proj.supabase.co/storage/v1/s3",
      region: "us-east-1",
      accessKey: "s3-akid",
      secret: "s3-secret",
      forcePathStyle: true,
    });
    expect(handle).toEqual({ egressId: "EG_abc123", storageKey: "camp-1/app-1.mp4" });
  });

  it("throws a clear error when recording is not configured", async () => {
    applyEnv({ ...FULL_ENV, SUPABASE_S3_ENDPOINT: undefined });

    await expect(
      startInterviewRecording({ roomName: "r", campaignId: "c", applicationId: "a" }),
    ).rejects.toThrow(/not configured/i);
    expect(mockStartEgress).not.toHaveBeenCalled();
  });
});
