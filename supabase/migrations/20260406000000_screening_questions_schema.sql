-- Migration: 20260406000000_screening_questions_schema.sql
-- Adds screening_questions and screening_question_responses tables for the
-- AI-generated screening questions flow. Recruiters generate + edit questions
-- per campaign, then send them to candidates who passed resume scoring.
-- Candidates submit answers via a public token-authenticated endpoint.

BEGIN;

-- 1. Screening response status enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'screening_response_status_enum') THEN
        CREATE TYPE screening_response_status_enum AS ENUM (
            'pending',
            'sent',
            'responded',
            'scored',
            'expired'
        );
    END IF;
END$$;

-- 2. Screening Questions (authored by the recruiter, one set per campaign)
CREATE TABLE IF NOT EXISTS public.screening_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screening_questions_campaign_id
    ON public.screening_questions(campaign_id);

CREATE TRIGGER set_screening_questions_updated_at
    BEFORE UPDATE ON public.screening_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Screening Question Responses (one row per application, holds the per-question answers and scores as JSONB)
CREATE TABLE IF NOT EXISTS public.screening_question_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    status screening_response_status_enum NOT NULL DEFAULT 'pending',
    -- answers: [{ question_id, prompt, answer_text, score, rationale }]
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    overall_score NUMERIC(5,2),
    overall_rationale TEXT,
    sent_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    scored_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id)
);

CREATE INDEX IF NOT EXISTS idx_screening_responses_application_id
    ON public.screening_question_responses(application_id);
CREATE INDEX IF NOT EXISTS idx_screening_responses_status
    ON public.screening_question_responses(status);

CREATE TRIGGER set_screening_responses_updated_at
    BEFORE UPDATE ON public.screening_question_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 4. Row Level Security

ALTER TABLE public.screening_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_question_responses ENABLE ROW LEVEL SECURITY;

-- screening_questions: recruiters can manage questions for their own campaigns
CREATE POLICY "Users can view screening_questions in their campaigns"
    ON public.screening_questions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = screening_questions.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert screening_questions for their campaigns"
    ON public.screening_questions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = screening_questions.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update screening_questions in their campaigns"
    ON public.screening_questions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = screening_questions.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete screening_questions in their campaigns"
    ON public.screening_questions
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = screening_questions.campaign_id
            AND c.user_id = auth.uid()
        )
    );

-- screening_question_responses: recruiters see/edit responses tied to their applications.
-- Public candidate writes happen via the service_role key in a Server Action after
-- the signed-token check succeeds; Postgres policy stays owner-only.
CREATE POLICY "Users can view screening_responses for their campaigns"
    ON public.screening_question_responses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = screening_question_responses.application_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert screening_responses for their campaigns"
    ON public.screening_question_responses
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = screening_question_responses.application_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update screening_responses for their campaigns"
    ON public.screening_question_responses
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = screening_question_responses.application_id
            AND c.user_id = auth.uid()
        )
    );

COMMIT;
