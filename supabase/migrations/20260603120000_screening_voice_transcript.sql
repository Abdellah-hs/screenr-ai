-- Migration: 20260603120000_screening_voice_transcript.sql
-- Voice screening (issue #83, tracer-bullet S3 of #80). The screening response
-- modality moves from a typed text form to a live OpenAI Realtime voice call.
-- The agent's + candidate's turns are captured as a transcript and persisted on
-- the existing screening_question_responses row, so the downstream scoring
-- pipeline (#84) reads a transcript instead of typed answers.
--
-- No new states/enums: the application state machine already covers
-- screening_completed / screening_expired / processing_failed.

BEGIN;

-- transcript: [{ role: 'agent' | 'candidate', text, at }] in spoken order.
-- Defaults to an empty array so existing (text-flow) rows stay valid.
ALTER TABLE public.screening_question_responses
    ADD COLUMN IF NOT EXISTS transcript JSONB NOT NULL DEFAULT '[]'::jsonb;

-- audio_url: optional pointer to the recorded call in Supabase Storage
-- (browser MediaRecorder upload). Reserved here so the audio slice doesn't
-- require a second migration; null until that path is wired.
ALTER TABLE public.screening_question_responses
    ADD COLUMN IF NOT EXISTS audio_url TEXT;

COMMIT;
