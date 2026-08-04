-- Migration: 20260804140000_drop_interview_recordings.sql
-- Retire AI video-interview recording (reverses 20260728120000_interview_recordings_bucket.sql).
--
-- The interview is no longer captured to storage. The candidate's camera now
-- exists only as a live LiveKit track: the agent worker samples frames in memory
-- for proctoring (local YOLOX detector) and discards them, so no video ever
-- leaves the room. That removes the largest store of candidate biometric data in
-- the system, and with it the S3 credentials the egress upload needed.
--
-- The interview's durable record is therefore the transcript, the score, and the
-- proctoring report — evidence that is text, versioned, and inspectable. The
-- tradeoff is deliberate and is reflected in the recruiter UI: a proctoring
-- finding can no longer be checked against footage, so the report states its own
-- fallibility instead of pointing at a recording.
--
-- Destructive: this deletes stored recordings. Anything worth keeping must be
-- downloaded before this runs.

BEGIN;

-- 1. Drop the storage RLS policies added for the bucket.
DROP POLICY IF EXISTS "Campaign owners can read interview recordings" ON storage.objects;
DROP POLICY IF EXISTS "Campaign owners can upload interview recordings" ON storage.objects;
DROP POLICY IF EXISTS "Campaign owners can delete interview recordings" ON storage.objects;

-- 2. Empty then remove the bucket (a bucket with objects can't be deleted).
DELETE FROM storage.objects WHERE bucket_id = 'interview-recordings';
DELETE FROM storage.buckets WHERE id = 'interview-recordings';

-- 3. Drop the column that held the object key. Nothing writes it any more.
ALTER TABLE public.interview_sessions
    DROP COLUMN IF EXISTS recording_url;

COMMIT;
