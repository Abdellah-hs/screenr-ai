-- Migration: 20260722120000_interview_sessions.sql
-- On-demand AI video interview (Phase A). After a candidate passes screening
-- they are moved to `interview_invited` and emailed a token link; they open a
-- desktop-only interview room, a server-side agent worker runs a résumé-grounded
-- conversational interview, and the transcript is captured server-side.
--
-- This table is the interview analogue of screening_question_responses: one row
-- per application, holding the live transcript draft + status. Scores, recording
-- pointer, and the proctoring report are reserved as nullable columns here so the
-- Phase B/C slices don't each need their own migration.
--
-- No new application states: the state machine already covers
-- interview_invited → interview_completed → interview_scored (+ interview_expired
-- / processing_failed). This row's own status is separate from application.status.

BEGIN;

-- 1. Interview session status enum (row lifecycle, distinct from application state)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interview_session_status_enum') THEN
        CREATE TYPE interview_session_status_enum AS ENUM (
            'invited',      -- link issued, candidate has not started
            'in_progress',  -- candidate is in the room / call is live
            'completed',    -- candidate submitted; transcript finalized
            'expired',      -- deadline passed before completion
            'failed'        -- call ended without a usable transcript
        );
    END IF;
END$$;

-- 2. Interview Sessions (one row per application)
CREATE TABLE IF NOT EXISTS public.interview_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    status interview_session_status_enum NOT NULL DEFAULT 'invited',
    -- transcript: [{ role: 'agent' | 'candidate', text, at }] in spoken order.
    transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Reserved for later slices so they need no extra migration:
    --   recording_url  — Phase B (LiveKit egress → storage)
    --   scores         — Phase B (per-section + overall, strengths/concerns)
    --   proctoring     — Phase C (frame-sampling + browser-signal report)
    recording_url TEXT,
    scores JSONB,
    proctoring JSONB,
    expires_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_application_id
    ON public.interview_sessions(application_id);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_status
    ON public.interview_sessions(status);

CREATE TRIGGER set_interview_sessions_updated_at
    BEFORE UPDATE ON public.interview_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Row Level Security
-- Recruiters see/manage interview sessions tied to their own campaigns.
-- Candidate + agent writes happen via the service_role key in a Server Action /
-- agent route AFTER the signed-token / AGENT_API_SECRET check succeeds; the
-- Postgres policy stays owner-only (mirrors screening_question_responses).
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view interview_sessions for their campaigns"
    ON public.interview_sessions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = interview_sessions.application_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert interview_sessions for their campaigns"
    ON public.interview_sessions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = interview_sessions.application_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update interview_sessions for their campaigns"
    ON public.interview_sessions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = interview_sessions.application_id
            AND c.user_id = auth.uid()
        )
    );

COMMIT;
