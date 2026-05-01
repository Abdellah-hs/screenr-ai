-- Migration: Add rubric_version and confidence to ai_audit_log
-- Compliance fields required for AI output calibration and audit trails.

BEGIN;

-- Add rubric_version (free-form text label, e.g. "v2.3-resume")
ALTER TABLE public.ai_audit_log
    ADD COLUMN IF NOT EXISTS rubric_version TEXT;

-- Add confidence (numeric 0-1 scale, nullable when provider doesn't return it)
ALTER TABLE public.ai_audit_log
    ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3);

COMMIT;
