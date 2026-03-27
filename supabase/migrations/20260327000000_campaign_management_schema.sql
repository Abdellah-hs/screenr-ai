-- ============================================================================
-- Phase 1: Campaign Management — Complete Schema (Consolidated)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUMS (matching src/lib/constants.ts) ──────────────────────────────────

CREATE TYPE campaign_status_enum AS ENUM (
  'draft', 'active', 'paused', 'closed', 'archived'
);

CREATE TYPE automation_mode_enum AS ENUM (
  'fully_auto', 'human_in_loop'
);

CREATE TYPE interview_persona_enum AS ENUM (
  'neutral', 'pressure', 'collaborative', 'socratic'
);

CREATE TYPE reviewer_role_enum AS ENUM (
  'lead', 'reviewer', 'observer'
);

CREATE TYPE pipeline_stage_enum AS ENUM (
  'resume', 'screening_q', 'interview'
);

-- ─── HELPER: updated_at trigger function ────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. campaigns
-- ============================================================================

CREATE TABLE campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  description           text NOT NULL DEFAULT '',
  department            text,
  positions             integer NOT NULL DEFAULT 1,
  status                campaign_status_enum NOT NULL DEFAULT 'draft',
  deadline              timestamptz,
  location              text,
  timezone              text DEFAULT 'UTC',
  automation_mode       automation_mode_enum NOT NULL DEFAULT 'fully_auto',
  screening_threshold   integer NOT NULL DEFAULT 50,
  interview_persona     interview_persona_enum NOT NULL DEFAULT 'neutral',
  screening_criteria    jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own campaigns"
  ON campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON campaigns FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON campaigns FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. screening_criteria
-- ============================================================================

CREATE TABLE screening_criteria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label       text NOT NULL,
  weight      numeric(5,2) NOT NULL DEFAULT 1.00,
  is_mandatory boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX idx_screening_criteria_campaign_id ON screening_criteria(campaign_id);

ALTER TABLE screening_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view screening criteria for their campaigns"
  ON screening_criteria FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = screening_criteria.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert screening criteria for their campaigns"
  ON screening_criteria FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = screening_criteria.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update screening criteria for their campaigns"
  ON screening_criteria FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = screening_criteria.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete screening criteria for their campaigns"
  ON screening_criteria FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = screening_criteria.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE TRIGGER set_screening_criteria_updated_at
  BEFORE UPDATE ON screening_criteria
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. evaluation_rubrics (versioned)
-- ============================================================================

CREATE TABLE evaluation_rubrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  stage       pipeline_stage_enum NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX idx_evaluation_rubrics_campaign_id ON evaluation_rubrics(campaign_id);

-- Only one active rubric per campaign per stage
CREATE UNIQUE INDEX idx_unique_active_rubric
  ON evaluation_rubrics(campaign_id, stage)
  WHERE is_active = true;

ALTER TABLE evaluation_rubrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view rubrics for their campaigns"
  ON evaluation_rubrics FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = evaluation_rubrics.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert rubrics for their campaigns"
  ON evaluation_rubrics FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = evaluation_rubrics.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update rubrics for their campaigns"
  ON evaluation_rubrics FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = evaluation_rubrics.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

-- ============================================================================
-- 4. rubric_dimensions
-- ============================================================================

CREATE TABLE rubric_dimensions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id   uuid NOT NULL REFERENCES evaluation_rubrics(id) ON DELETE CASCADE,
  name        text NOT NULL,
  weight      numeric(5,2) NOT NULL DEFAULT 1.00,
  is_mandatory boolean NOT NULL DEFAULT false,
  min_score   integer NOT NULL DEFAULT 0,
  max_score   integer NOT NULL DEFAULT 10,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX idx_rubric_dimensions_rubric_id ON rubric_dimensions(rubric_id);

ALTER TABLE rubric_dimensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dimensions for their rubrics"
  ON rubric_dimensions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM evaluation_rubrics
    JOIN campaigns ON campaigns.id = evaluation_rubrics.campaign_id
    WHERE evaluation_rubrics.id = rubric_dimensions.rubric_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert dimensions for their rubrics"
  ON rubric_dimensions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM evaluation_rubrics
    JOIN campaigns ON campaigns.id = evaluation_rubrics.campaign_id
    WHERE evaluation_rubrics.id = rubric_dimensions.rubric_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update dimensions for their rubrics"
  ON rubric_dimensions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM evaluation_rubrics
    JOIN campaigns ON campaigns.id = evaluation_rubrics.campaign_id
    WHERE evaluation_rubrics.id = rubric_dimensions.rubric_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete dimensions for their rubrics"
  ON rubric_dimensions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM evaluation_rubrics
    JOIN campaigns ON campaigns.id = evaluation_rubrics.campaign_id
    WHERE evaluation_rubrics.id = rubric_dimensions.rubric_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE TRIGGER set_rubric_dimensions_updated_at
  BEFORE UPDATE ON rubric_dimensions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. campaign_reviewers
-- ============================================================================

CREATE TABLE campaign_reviewers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        reviewer_role_enum NOT NULL DEFAULT 'reviewer',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX idx_campaign_reviewers_campaign_id ON campaign_reviewers(campaign_id);
CREATE INDEX idx_campaign_reviewers_user_id ON campaign_reviewers(user_id);

ALTER TABLE campaign_reviewers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reviewers for their campaigns"
  ON campaign_reviewers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_reviewers.campaign_id
        AND campaigns.user_id = auth.uid()
    )
    OR campaign_reviewers.user_id = auth.uid()
  );

CREATE POLICY "Users can insert reviewers for their campaigns"
  ON campaign_reviewers FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_reviewers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update reviewers for their campaigns"
  ON campaign_reviewers FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_reviewers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete reviewers for their campaigns"
  ON campaign_reviewers FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_reviewers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

-- ============================================================================
-- 6. sla_timers
-- ============================================================================

CREATE TABLE sla_timers (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  stage                       varchar(50) NOT NULL,
  time_limit_hours            integer NOT NULL,
  alert_threshold_hours       integer NOT NULL,
  escalation_threshold_hours  integer NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, stage),
  CHECK (alert_threshold_hours <= time_limit_hours),
  CHECK (escalation_threshold_hours >= alert_threshold_hours)
);

CREATE INDEX idx_sla_timers_campaign_id ON sla_timers(campaign_id);

ALTER TABLE sla_timers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view SLA timers for their campaigns"
  ON sla_timers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = sla_timers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert SLA timers for their campaigns"
  ON sla_timers FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = sla_timers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update SLA timers for their campaigns"
  ON sla_timers FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = sla_timers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete SLA timers for their campaigns"
  ON sla_timers FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = sla_timers.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE TRIGGER set_sla_timers_updated_at
  BEFORE UPDATE ON sla_timers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. campaign_audit_log (APPEND-ONLY)
-- ============================================================================

CREATE TABLE campaign_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_audit_log_campaign_id ON campaign_audit_log(campaign_id);
CREATE INDEX idx_campaign_audit_log_user_id ON campaign_audit_log(user_id);
CREATE INDEX idx_campaign_audit_log_action ON campaign_audit_log(action);
CREATE INDEX idx_campaign_audit_log_created_at ON campaign_audit_log(created_at);

ALTER TABLE campaign_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view audit logs for their campaigns"
  ON campaign_audit_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_audit_log.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert audit log entries"
  ON campaign_audit_log FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_audit_log.campaign_id
      AND campaigns.user_id = auth.uid()
  ));
