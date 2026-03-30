-- Migration: 20260330174903_candidate_pipeline_schema.sql

BEGIN;

-- 1. Create candidate_stage_enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candidate_stage_enum') THEN
        CREATE TYPE candidate_stage_enum AS ENUM (
            'new',
            'screening',
            'screening_q',
            'interview',
            'manager_review',
            'rejected',
            'hired',
            'withdrawn'
        );
    END IF;
END$$;

-- 2. Candidates Table (Global)
CREATE TABLE IF NOT EXISTS public.candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    linkedin_url TEXT,
    portfolio_url TEXT,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 3. Applications Table (Link Candidates to Campaigns)
CREATE TABLE IF NOT EXISTS public.applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    status candidate_stage_enum NOT NULL DEFAULT 'new',
    resume_url TEXT,
    parsed_data JSONB,
    resume_score NUMERIC(5,2),
    screening_q_score NUMERIC(5,2),
    interview_score NUMERIC(5,2),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(candidate_id, campaign_id)
);

-- Indexes for Applications
CREATE INDEX idx_applications_candidate_id ON public.applications(candidate_id);
CREATE INDEX idx_applications_campaign_id ON public.applications(campaign_id);
CREATE INDEX idx_applications_status ON public.applications(status);

-- 4. AI Audit Log Table (Append Only)
CREATE TABLE IF NOT EXISTS public.ai_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES public.candidates(id) ON DELETE SET NULL,
    stage TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_snapshot JSONB NOT NULL,
    raw_output TEXT NOT NULL,
    parsed_score NUMERIC(5,2),
    rationale TEXT,
    action_taken TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for AI Audit Log
CREATE INDEX idx_ai_audit_log_campaign_id ON public.ai_audit_log(campaign_id);
CREATE INDEX idx_ai_audit_log_candidate_id ON public.ai_audit_log(candidate_id);

-- 5. Updated_at triggers
CREATE TRIGGER set_candidates_updated_at
    BEFORE UPDATE ON public.candidates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_applications_updated_at
    BEFORE UPDATE ON public.applications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. Row Level Security

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;

-- Candidates RLS (Users can view/edit candidates that have an application in their campaigns)
CREATE POLICY "Users can view candidates in their campaigns"
    ON public.candidates
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.candidate_id = candidates.id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert candidates"
    ON public.candidates
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update candidates in their campaigns"
    ON public.candidates
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.candidate_id = candidates.id
            AND c.user_id = auth.uid()
        )
    );

-- Applications RLS
CREATE POLICY "Users can view applications in their campaigns"
    ON public.applications
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = applications.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert applications for their campaigns"
    ON public.applications
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = applications.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update applications in their campaigns"
    ON public.applications
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = applications.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete applications in their campaigns"
    ON public.applications
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = applications.campaign_id
            AND c.user_id = auth.uid()
        )
    );

-- AI Audit Log RLS (Append Only)
CREATE POLICY "Users can view ai_audit_log for their campaigns"
    ON public.ai_audit_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = ai_audit_log.campaign_id
            AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert ai_audit_log for their campaigns"
    ON public.ai_audit_log
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = ai_audit_log.campaign_id
            AND c.user_id = auth.uid()
        )
    );
-- No UPDATE or DELETE policies for ai_audit_log to enforce append-only

-- 7. Supabase Storage: Resumes Bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
-- Managers can upload/read resumes for their campaigns
CREATE POLICY "Authenticated users can upload resumes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'resumes');

CREATE POLICY "Authenticated users can read resumes"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'resumes');

CREATE POLICY "Authenticated users can delete resumes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'resumes');

COMMIT;
