-- Migration: Add rubric_version to applications and screening_question_responses
--
-- Stamps the active rubric version onto every score write so the UI can flag
-- candidates scored under an older rubric than the campaign's current one.
-- Mirrors the rubric_version column added to ai_audit_log in migration
-- 20260501022125_ai_audit_log_rubric_version_confidence.sql.
--
-- Nullable on purpose: rows scored before this migration keep NULL, which the
-- UI interprets as "rubric version unknown — do not show a mismatch badge."

ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS rubric_version INTEGER;

COMMENT ON COLUMN public.applications.rubric_version IS
    'Version of the resume-stage evaluation_rubric active when this application was scored. NULL means scored before versioning was tracked.';

ALTER TABLE public.screening_question_responses
    ADD COLUMN IF NOT EXISTS rubric_version INTEGER;

COMMENT ON COLUMN public.screening_question_responses.rubric_version IS
    'Version of the screening_q-stage evaluation_rubric active when these answers were scored. NULL means scored before versioning was tracked.';
