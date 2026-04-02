-- Migration: Add detailed resume scoring columns to applications
-- The resume_score column already exists (NUMERIC 0-100).
-- Adding tier classification, rationale, and per-factor breakdown.

BEGIN;

-- Screening tier enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'screening_tier_enum') THEN
        CREATE TYPE screening_tier_enum AS ENUM (
            'strong', 'moderate', 'weak', 'no_match'
        );
    END IF;
END$$;

-- Add scoring detail columns
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS screening_tier screening_tier_enum,
    ADD COLUMN IF NOT EXISTS score_rationale TEXT,
    ADD COLUMN IF NOT EXISTS score_factors JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

-- Index for filtering by tier
CREATE INDEX IF NOT EXISTS idx_applications_screening_tier
    ON public.applications(screening_tier);

COMMIT;
