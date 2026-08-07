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
-- Destructive: the recordings themselves are deleted OUT OF BAND (see below).
-- Anything worth keeping must be downloaded before that is done.
--
-- The bucket and its objects are NOT dropped here. Supabase rejects direct DML
-- against the storage tables from SQL:
--
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead. (SQLSTATE 42501)
--
-- so emptying and deleting the bucket is a one-off operational step, run once
-- against each environment with the service-role key:
--
--   POST   /storage/v1/bucket/interview-recordings/empty
--   DELETE /storage/v1/bucket/interview-recordings
--
-- (or Storage → interview-recordings → Delete bucket in the dashboard). Done on
-- the production project 2026-08-04. Policies and the column, which are ordinary
-- schema, still belong in the migration below.

BEGIN;

-- 1. Drop the storage RLS policies added for the bucket. These survive the
-- bucket itself — they are rows in pg_policy on storage.objects, so deleting the
-- bucket via the API leaves them behind to accumulate.
DROP POLICY IF EXISTS "Campaign owners can read interview recordings" ON storage.objects;
DROP POLICY IF EXISTS "Campaign owners can upload interview recordings" ON storage.objects;
DROP POLICY IF EXISTS "Campaign owners can delete interview recordings" ON storage.objects;

-- 2. Drop the column that held the object key. Nothing writes it any more.
ALTER TABLE public.interview_sessions
    DROP COLUMN IF EXISTS recording_url;

COMMIT;
