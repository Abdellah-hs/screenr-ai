-- Migration: 20260804120000_screening_proctoring.sql
-- Browser proctoring for the voice screening.
--
-- Screening is where a candidate has the strongest incentive to go looking: the
-- questions are known in advance of the answer, and "hold on a second" costs
-- them nothing. Until now only the AI video interview was watched at all, so the
-- earlier and easier stage to game was the unmonitored one.
--
-- Stores the same `ProctoringReport` shape the interview uses, produced by the
-- same `summarizeProctoring` rules, so thresholds and severity live in exactly
-- one place and a report from either stage reads identically.
--
-- Screening is voice-only, so in practice only `tab_blur` incidents appear here:
-- there is no camera to go dark and none to analyse. That also means this stage
-- has ONLY the browser-reported half of proctoring, with no server-side signal
-- to corroborate it — a candidate who edits their submit payload can produce a
-- clean report. It is a tripwire for the careless, not a control, and the
-- recruiter UI says so rather than implying more certainty than exists.

BEGIN;

ALTER TABLE public.screening_question_responses
    ADD COLUMN IF NOT EXISTS proctoring JSONB;

COMMENT ON COLUMN public.screening_question_responses.proctoring IS
    'Proctoring report for the voice screening (browser tab-focus signals only; no camera at this stage). Same shape as interview_sessions.proctoring, produced by summarizeProctoring. Advisory evidence — never affects the screening score or any transition.';

COMMIT;
