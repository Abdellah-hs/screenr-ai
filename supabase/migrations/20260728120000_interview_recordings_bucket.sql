-- Migration: 20260728120000_interview_recordings_bucket.sql
-- AI video-interview session recording (Phase B2). LiveKit Egress records the
-- interview room (candidate camera + agent audio, composited) and uploads an MP4
-- straight to Supabase Storage via the S3-compatible endpoint. The app never
-- streams the bytes — it only stores the object KEY on interview_sessions.recording_url
-- and mints short-lived signed URLs for the owning recruiter (mirrors the
-- `resumes` bucket + getResumeSignedUrl pattern).
--
-- Private bucket: candidate video is sensitive, so nothing is world-readable.
-- The object key is `<campaign_id>/<application_id>.mp4`, so the first path
-- segment is the campaign id — the same convention the `resumes` bucket uses,
-- which lets the storage RLS policies scope access to the campaign owner.

BEGIN;

-- 1. Private bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('interview-recordings', 'interview-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Owner-scoped storage RLS — only the campaign owner can read/write objects
-- under their campaign folder. Egress itself uploads with the project S3 keys
-- (which bypass RLS, like the service role), so these policies exist for the
-- recruiter-facing read path and manual cleanup, mirroring the resumes bucket.
CREATE POLICY "Campaign owners can read interview recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'interview-recordings'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

CREATE POLICY "Campaign owners can upload interview recordings"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'interview-recordings'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

CREATE POLICY "Campaign owners can delete interview recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'interview-recordings'
  AND EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = (storage.foldername(name))[1]::uuid
      AND campaigns.user_id = auth.uid()
  )
);

COMMIT;
