import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from "livekit-server-sdk";

/**
 * LiveKit Egress → Supabase S3 recording of the AI video interview (Phase B2).
 *
 * When the candidate starts their interview we kick off a Room Composite Egress:
 * LiveKit records the whole room (candidate camera + agent audio, composited)
 * and uploads the finished MP4 straight to a private Supabase Storage bucket
 * over its S3-compatible endpoint. The app never touches the media bytes — it
 * only stores the object KEY on `interview_sessions.recording_url` and mints a
 * short-lived signed URL for the owning recruiter at read time (mirrors how the
 * `resumes` bucket + `getResumeSignedUrl` work).
 *
 * Recording is best-effort and fully decoupled from the interview: if the S3
 * credentials aren't set, `isInterviewRecordingConfigured()` returns false and
 * the caller simply skips recording — the interview itself is unaffected (same
 * fail-closed posture as the LinkedIn / Gmail integrations).
 */

const DEFAULT_RECORDING_BUCKET = "interview-recordings";

interface EgressS3Config {
  endpoint: string;
  region: string;
  accessKey: string;
  secret: string;
  bucket: string;
}

interface LiveKitCredentials {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Deterministic object key: `<campaign_id>/<application_id>.mp4`. The campaign
 * id is the FIRST path segment on purpose — the `interview-recordings` bucket's
 * storage RLS scopes access by that segment (same convention as `resumes`), so
 * only the campaign owner can read the file back. The per-application key also
 * means a re-recorded interview overwrites the previous attempt, matching the
 * transcript-draft overwrite semantics.
 */
export function interviewRecordingKey(campaignId: string, applicationId: string): string {
  return `${campaignId}/${applicationId}.mp4`;
}

function readS3Config(): EgressS3Config | null {
  const endpoint = process.env.SUPABASE_S3_ENDPOINT;
  const region = process.env.SUPABASE_S3_REGION;
  const accessKey = process.env.SUPABASE_S3_ACCESS_KEY_ID;
  const secret = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !accessKey || !secret) return null;
  return {
    endpoint,
    region,
    accessKey,
    secret,
    bucket: process.env.INTERVIEW_RECORDING_BUCKET || DEFAULT_RECORDING_BUCKET,
  };
}

function readLiveKitCredentials(): LiveKitCredentials | null {
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) return null;
  return { serverUrl, apiKey, apiSecret };
}

/** Whether both LiveKit and the Supabase S3 destination are configured. When
 *  false, the interview runs normally but nothing is recorded. */
export function isInterviewRecordingConfigured(): boolean {
  return readS3Config() !== null && readLiveKitCredentials() !== null;
}

export interface InterviewRecordingHandle {
  egressId: string;
  /** Object key stored on the session; resolve to a signed URL for playback. */
  storageKey: string;
}

/**
 * Start recording an interview room to Supabase S3. Throws (rather than silently
 * no-op'ing) when unconfigured so the caller's best-effort wrapper can log a
 * precise reason; call `isInterviewRecordingConfigured()` first to skip cleanly.
 */
export async function startInterviewRecording(args: {
  roomName: string;
  campaignId: string;
  applicationId: string;
}): Promise<InterviewRecordingHandle> {
  const s3 = readS3Config();
  if (!s3) {
    throw new Error(
      "Interview recording is not configured (SUPABASE_S3_ENDPOINT / SUPABASE_S3_REGION / SUPABASE_S3_ACCESS_KEY_ID / SUPABASE_S3_SECRET_ACCESS_KEY).",
    );
  }
  const lk = readLiveKitCredentials();
  if (!lk) {
    throw new Error(
      "LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET must be set to record interviews.",
    );
  }

  const storageKey = interviewRecordingKey(args.campaignId, args.applicationId);

  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: storageKey,
    // The signed-URL playback path only needs the media file; skip the sidecar
    // manifest object egress would otherwise write next to it.
    disableManifest: true,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: s3.accessKey,
        secret: s3.secret,
        region: s3.region,
        endpoint: s3.endpoint,
        bucket: s3.bucket,
        // Supabase's S3 gateway addresses objects path-style, not virtual-host.
        forcePathStyle: true,
      }),
    },
  });

  const egress = new EgressClient(lk.serverUrl, lk.apiKey, lk.apiSecret);
  const info = await egress.startRoomCompositeEgress(args.roomName, output);

  return { egressId: info.egressId, storageKey };
}
