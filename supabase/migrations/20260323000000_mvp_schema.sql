-- MVP Schema: extend campaigns, create candidates + scores, storage bucket

-- 1. Extend campaigns with AI settings and JSONB fields
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS automation_mode TEXT NOT NULL DEFAULT 'human_in_loop'
    CHECK (automation_mode IN ('fully_auto', 'human_in_loop')),
  ADD COLUMN IF NOT EXISTS screening_threshold INTEGER NOT NULL DEFAULT 70
    CHECK (screening_threshold >= 0 AND screening_threshold <= 100),
  ADD COLUMN IF NOT EXISTS interview_persona TEXT NOT NULL DEFAULT 'neutral'
    CHECK (interview_persona IN ('neutral', 'pressure', 'collaborative', 'socratic')),
  ADD COLUMN IF NOT EXISTS rubrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sla_timers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Update status CHECK to include 'archived'
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'closed', 'archived'));

-- 2. Create candidates table
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  current_title TEXT,
  current_company TEXT,
  stage TEXT NOT NULL DEFAULT 'applied'
    CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
  resume JSONB NOT NULL DEFAULT '{}'::jsonb,
  resume_url TEXT,
  resume_text TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_candidates_campaign_id ON candidates(campaign_id);
CREATE INDEX idx_candidates_user_id ON candidates(user_id);
CREATE INDEX idx_candidates_stage ON candidates(stage);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own candidates"
  ON candidates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own candidates"
  ON candidates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own candidates"
  ON candidates FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own candidates"
  ON candidates FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Create candidate_scores table
CREATE TABLE candidate_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('resume', 'screening', 'interview')),
  overall INTEGER NOT NULL CHECK (overall >= 0 AND overall <= 100),
  tier TEXT CHECK (tier IN ('strong', 'moderate', 'weak')),
  ai_summary TEXT NOT NULL DEFAULT '',
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  scored_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_candidate_scores_candidate_id ON candidate_scores(candidate_id);

ALTER TABLE candidate_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scores for their candidates"
  ON candidate_scores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM candidates
    WHERE candidates.id = candidate_scores.candidate_id
      AND candidates.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert scores for their candidates"
  ON candidate_scores FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM candidates
    WHERE candidates.id = candidate_scores.candidate_id
      AND candidates.user_id = auth.uid()
  ));

CREATE POLICY "Users can update scores for their candidates"
  ON candidate_scores FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM candidates
    WHERE candidates.id = candidate_scores.candidate_id
      AND candidates.user_id = auth.uid()
  ));

-- 4. Create storage bucket for resumes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  false,
  10485760,
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
) ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload resumes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view their own resumes"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
