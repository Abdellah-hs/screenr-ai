-- Migration: 20260803120000_interview_vision_proctoring.sql
-- Vision proctoring for the AI video interview (Phase C2).
--
-- Phase C proctoring was browser-observable only: tab focus and whether the
-- local camera track was live. Those signals come from the candidate's own
-- machine, so they can only ever say "the camera was on" — never who was in
-- front of it. This slice adds a SERVER-side signal: the interview agent worker
-- samples frames from the candidate's published video track, runs a vision model
-- over them, and reports structured observations back to the app.
--
-- The observations arrive DURING the interview (like transcript turns), while
-- the `proctoring` report is written once at submit. They therefore need their
-- own draft column rather than sharing `proctoring`, which would make that
-- column bi-modal (half-built draft vs finalized report) and unreadable to the
-- recruiter UI mid-interview.
--
-- Trust model is unchanged and deliberately conservative: these are OBSERVATIONS
-- carrying a model confidence, never verdicts. `summarizeProctoring` still owns
-- severity server-side, the report stays advisory evidence, and nothing here
-- terminates an interview, transitions an application, or feeds the score.

BEGIN;

ALTER TABLE public.interview_sessions
    ADD COLUMN IF NOT EXISTS proctoring_observations JSONB;

COMMENT ON COLUMN public.interview_sessions.proctoring_observations IS
    'Draft vision-proctoring observations reported by the interview agent worker during the call: [{at, face_count, confidence}]. Folded into `proctoring` by summarizeProctoring at submit. Evidence only — never a verdict.';

COMMIT;
